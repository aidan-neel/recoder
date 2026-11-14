import { app } from './app';
import { env } from './env';
import { serverDataDir } from './util/data-dir';
import { opencode } from './agents/opencode/opencode';
import { deleteChatGptTokens } from './review/session/chatgpt-migration';
import { registeredAgents } from './agents/registry';
import { initReviewSettings } from './review/session/review-settings';
import { initVllmServers } from './models/vllm/vllm-store';
import { startVllmSync } from './models/vllm/vllm-sync';
import { findAdmin } from './accounts/account-store';
import { startSetupCode } from './accounts/setup-code';
import { sealStoredRefreshToken, startTokenRefresh } from './accounts/token-refresh';
import { forgeAuthStatus } from './forge/auth-status';
import { initTokenStore } from './forge/tokens';
import { describeSecretKeySource, secretKey } from './secrets/secret-key';
import { SharedSettingsConflictError } from './config/shared-settings';
import { startPullSweep } from './forge/pulls/state-sweep';
import { restartWatcher } from './forge/watch/watcher';
import { closeStore, exitOnShutdownSignals, recoverStaleReviews } from './store';
import { coordinator, initializeStorage, postgres, settingsOperation } from './storage/backend';
import { resumeAfterUpdate } from './update/pauses';
import { SUCCESSOR_ENV, waitForPortRelease } from './update/restart';
import { startReviewWorkers } from './review/runtime/worker';
import { executeReviewActor } from './review/runtime/actor';
import { startSharedMaintenance } from './review/runtime/maintenance';
import { recoverRepoChats } from './repo-chat/chat-turns';
import { interruptLocalReplies } from './repo-chat/chat-reply';
import { backfillModelCalls, pruneModelCalls } from './usage/model-calls';

/**
 * Start the agents' checks now so Settings never waits on a cold start:
 * OpenCode with its provider catalog, and every other agent CLI's install and
 * sign-in check, so the first Check again after a restart can answer from it
 * instead of waiting on the CLI.
 */
function warmAgents(): void {
	void opencode
		.detect()
		.then((status) => (status.error ? undefined : opencode.providers()))
		.catch(() => {});

	for (const agent of registeredAgents()) {
		if (agent !== opencode) void agent.detect().catch(() => {});
	}
}

/** Checks the forge connections now, so the first `/api/auth/me` of a fresh install answers from the cache. */
function warmForgeStatus(): void {
	void forgeAuthStatus().catch((error: unknown) =>
		console.error('[accounts] forge status check failed', error instanceof Error ? error.name : typeof error)
	);
}

/**
 * Requests that may sit quiet past Bun's 10 second idle timeout: review
 * conversations stay subscribed while the agents are idle, and model calls
 * (drafts, answers, fixes, the home brief, provider checks) can think for a
 * long time before the first byte. Each route keeps its own deadline.
 */
const LONG_LIVED = [
	/^\/api\/reviews\/[^/]+\/(events|discuss|discuss\/stream|rereview|fixes\/suggest)$/,
	/^\/api\/chats\/[^/]+\/events$/,
	/^\/api\/guidelines\/draft$/,
	/^\/api\/home\/brief$/,
	/^\/api\/settings\/providers\/[^/]+\/(connect|catalog)$/,
	/^\/api\/settings\/models(\/discover)?$/,
	/^\/api\/settings\/vllm(\/refresh)?$/
];

function isLongLived(path: string): boolean {
	return LONG_LIVED.some((pattern) => pattern.test(path));
}

/**
 * Where a stray rejection came from: its error's name and stack frames. The
 * message is left out, since a failed request's message can carry a token or
 * a key.
 */
function rejectionTrace(reason: unknown): string {
	if (!(reason instanceof Error)) return typeof reason;

	const frames = (reason.stack ?? '').split('\n').filter((line) => line.trimStart().startsWith('at '));

	return [reason.name, ...frames.slice(0, 8)].join('\n');
}

/**
 * Bun exits on a rejection nobody handled, which would end every running
 * review over one dropped promise. Log where it came from and keep serving.
 */
function logStrayRejections(): void {
	process.on('unhandledRejection', (reason) => console.error('[recoder] unhandled rejection', rejectionTrace(reason)));
}

/**
 * Seals the credentials PostgreSQL holds from before sealing existed. A conflict means another replica saved the
 * same documents first, and anything it saved is sealed.
 */
async function sealSharedCredentials(): Promise<void> {
	try {
		await settingsOperation(() => {
			initTokenStore();
			initReviewSettings();
			initVllmServers();
		});
	} catch (error) {
		if (!(error instanceof SharedSettingsConflictError)) throw error;
	}
}

logStrayRejections();

console.log(`recoder secret key: ${describeSecretKeySource(secretKey().source)}`);
await initializeStorage();
await deleteChatGptTokens(serverDataDir());
await backfillModelCalls();
await pruneModelCalls();

let stopWorkers: (() => Promise<void>) | undefined;
const stopMaintenance = postgres ? startSharedMaintenance(postgres) : undefined;

if (coordinator) {
	await sealSharedCredentials();

	stopWorkers = startReviewWorkers(
		coordinator,
		{
			ownerId: env.RECODER_INSTANCE_ID ?? crypto.randomUUID(),
			concurrency: env.RECODER_JOB_CONCURRENCY,
			leaseMs: env.RECODER_JOB_LEASE_MS,
			pollMs: env.RECODER_JOB_POLL_MS
		},
		executeReviewActor
	);
} else {
	exitOnShutdownSignals();
	initTokenStore();
	initReviewSettings();
	initVllmServers();
	await recoverStaleReviews();
	await resumeAfterUpdate();
	await recoverRepoChats();
	warmAgents();
	warmForgeStatus();
	startVllmSync();
	startPullSweep();
	restartWatcher();
}

await sealStoredRefreshToken();
await startSetupCode((await findAdmin()) !== undefined);
startTokenRefresh();

/** An update's successor waits for the old server's port before it binds its own. */
if (process.env[SUCCESSOR_ENV]) await waitForPortRelease(env.HOST, env.PORT);

const server = Bun.serve({
	fetch(request, server) {
		if (isLongLived(new URL(request.url).pathname)) server.timeout(request, 0);

		return app.fetch(request, server);
	},
	port: env.PORT,
	hostname: env.HOST
});

console.log(`recoder server listening on http://${server.hostname}:${server.port}`);
console.log(`recoder data dir: ${serverDataDir()}`);

if (postgres) {
	let stopping = false;

	for (const signal of ['SIGINT', 'SIGTERM'] as const) {
		process.on(signal, async () => {
			if (stopping) return;

			stopping = true;
			await server.stop(true);
			await interruptLocalReplies();
			await stopMaintenance?.();
			await stopWorkers?.();

			try {
				await closeStore();
			} catch {
				console.error(
					'[server] some queued writes could not flush before shutdown; another server can recover the review'
				);
			}

			process.exit(signal === 'SIGINT' ? 130 : 143);
		});
	}
}
