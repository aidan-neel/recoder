import { app } from './app';
import { env } from './env';
import { serverDataDir } from './util/data-dir';
import { claudeCode } from './agents/claude-code/claude-code';
import { opencode } from './agents/opencode/opencode';
import { initReviewSettings } from './review/session/review-settings';
import { initTokenStore } from './forge/tokens';
import { recoverStaleReviews } from './store';

/**
 * Start the agents' checks now so Settings never waits on a cold start:
 * OpenCode with its provider catalog, and Claude Code's sign-in, so the first
 * Check again after a restart can answer from it instead of waiting on the CLI.
 */
function warmAgents(): void {
	void opencode
		.detect()
		.then((status) => (status.error ? undefined : opencode.providers()))
		.catch(() => {});

	void claudeCode.detect().catch(() => {});
}

/**
 * Requests that may sit quiet past Bun's 10 second idle timeout: review
 * conversations stay subscribed while the agents are idle, and model calls
 * (drafts, answers, fixes, the home brief, provider checks) can think for a
 * long time before the first byte. Each route keeps its own deadline.
 */
const LONG_LIVED = [
	/^\/api\/reviews\/[^/]+\/(events|discuss|discuss\/stream|rereview|fixes\/suggest)$/,
	/^\/api\/guidelines\/draft$/,
	/^\/api\/home\/brief$/,
	/^\/api\/settings\/providers\/[^/]+\/(connect|catalog)$/,
	/^\/api\/settings\/models(\/discover)?$/
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

logStrayRejections();
initTokenStore();
initReviewSettings();
recoverStaleReviews();
warmAgents();

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
