import { realpath } from 'node:fs/promises';
import type { UpdateAvailable, UpdateMode, UpdateStatus, WebRestart } from '@recoder/shared';
import { CliError, EXIT } from '../cli/exit';
import { githubReleases, type ReleaseSource } from '../cli/upgrade/release-source';
import { installRelease, planUpgrade, type RunningProgram } from '../cli/upgrade/upgrade';
import { VERSION } from '../version';
import { detectUpdateMode, localEnvironment, type UpdateEnvironment } from './environment';
import { gitCheckout, type GitInspection } from './git';
import { releaseReviewStarts } from './hold';
import { pauseReviewsForUpdate, resumeHeldReviews } from './pauses';
import { UPDATE_RECORD_ID, toStatus, updateRecords, type UpdateRecord } from './record';
import { restartThroughSuccessor } from './restart';
import { spawnProcess, requireSuccess, type RunProcess } from './run';
import { detectWebRestart } from './webapp';
import { classifyPaths, readWorkspaceGraph } from './workspace';

/** How long `bun install` may take on a cold cache. */
const INSTALL_TIMEOUT_MS = 300_000;

/** How long a new binary may take to print its version before it counts as broken. */
const BINARY_CHECK_TIMEOUT_MS = 15_000;

/** States a live apply moves through; another apply may not start while one holds them. */
const APPLYING = new Set(['checking', 'pausing', 'updating', 'restarting', 'resuming']);

/** A second POST while an update runs. */
export class UpdateBusyError extends Error {
	constructor() {
		super('An update is already running.');
		this.name = 'UpdateBusyError';
	}
}

/** The update cannot apply — the reason is the status's `blockedReason`. */
export class UpdateRefusedError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'UpdateRefusedError';
	}
}

/** Everything an update needs from the machine; production fills it with the real one. */
export interface UpdateDeps {
	environment: UpdateEnvironment;
	/** Spawns `git` and `bun`; a test owns them through a fake PATH. */
	run: RunProcess;
	/** Env for spawned tools — a test's PATH. */
	toolEnv?: Record<string, string>;
	/** Binary mode: the file `installRelease` replaces. Defaults to this process's executable. */
	executable?: string;
	/** Binary mode: where releases come from. Defaults to GitHub. */
	releases?: ReleaseSource;
	/** The restart step; production spawns a detached successor and exits. */
	restart?: () => void;
	/** How the web app's supervision is read. Defaults to /proc. */
	detectWeb?: (root: string) => Promise<WebRestart>;
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/**
 * The admin's update actions: check what is upstream, apply it, and report
 * both through a durable record the UI polls — across the restart the apply
 * ends in. `resumeAfterUpdate` (see pauses.ts) is the successor's half.
 */
export function createUpdateService(deps: UpdateDeps) {
	const environment = deps.environment;
	const restart = deps.restart ?? restartThroughSuccessor;
	const detectWeb = deps.detectWeb ?? detectWebRestart;

	let detected: { mode: UpdateMode; managedNote?: string } | undefined;

	/** How this install runs, asked once — it cannot change under a live process. */
	async function detection(): Promise<{ mode: UpdateMode; managedNote?: string }> {
		detected ??= await detectUpdateMode(environment, deps.run);

		return detected;
	}

	async function read(): Promise<UpdateRecord | undefined> {
		return updateRecords.get(UPDATE_RECORD_ID);
	}

	/** One record's next revision; the id never changes. */
	async function write(patch: Partial<UpdateRecord>): Promise<UpdateRecord> {
		const base: UpdateRecord = {
			id: UPDATE_RECORD_ID,
			state: 'idle',
			mode: 'git',
			current: {},
			available: null,
			pausedReviewIds: [],
			updatedAt: ''
		};

		const next = await updateRecords.update(UPDATE_RECORD_ID, (current) => ({
			...base,
			...current,
			...patch,
			id: UPDATE_RECORD_ID,
			updatedAt: new Date().toISOString()
		}));

		return next ?? { ...base, ...patch };
	}

	async function status(): Promise<UpdateStatus> {
		const saved = await read();

		if (saved) return toStatus(saved);

		const detectionResult = await detection();

		return {
			mode: detectionResult.mode,
			current: detectionResult.mode === 'git' ? await gitCurrent() : { version: VERSION },
			available: null,
			state: 'idle',
			...(detectionResult.managedNote !== undefined ? { managedNote: detectionResult.managedNote } : {})
		};
	}

	async function gitCurrent() {
		const inspection = await gitCheckout(environment.root, deps.run, deps.toolEnv).inspect();

		return { version: VERSION, commit: inspection.commit, ...(inspection.branch ? { branch: inspection.branch } : {}) };
	}

	/** Why an inspection refuses an update, or undefined when it may apply. */
	function blockedReason(inspection: GitInspection): string | undefined {
		if (inspection.upstream === undefined) return 'the checked-out branch has no upstream to update from.';

		if (inspection.dirtyPaths.length) {
			return `the working tree has ${inspection.dirtyPaths.length} uncommitted ${inspection.dirtyPaths.length === 1 ? 'change' : 'changes'}; commit or clean them first.`;
		}

		if (inspection.ahead > 0 && inspection.behind > 0) {
			return `the branch has diverged from ${inspection.upstream} (${inspection.ahead} ahead, ${inspection.behind} behind); rebase or reset it first.`;
		}

		return undefined;
	}

	/** The running program as the binary upgrade sees it. */
	async function binaryProgram(): Promise<RunningProgram> {
		return {
			version: VERSION,
			executable: deps.executable ?? (await realpath(process.execPath)),
			platform: process.platform,
			arch: process.arch,
			releases: deps.releases ?? githubReleases(fetch),
			check: checkBinary,
			signal: new AbortController().signal
		};
	}

	/** Runs a candidate binary's `--version`; one that does not start or lies is not installed. */
	async function checkBinary(candidate: string, version: string): Promise<void> {
		const result = await deps.run([candidate, '--version'], { env: deps.toolEnv, timeoutMs: BINARY_CHECK_TIMEOUT_MS });

		if (result.exitCode !== 0 || result.stdout.trim() !== version) {
			throw new CliError(`the new binary does not say it is ${version}. Nothing was installed.`, EXIT.failed);
		}
	}

	async function installDependencies(): Promise<void> {
		requireSuccess(
			['bun', 'install'],
			await deps.run(['bun', 'install'], { cwd: environment.root, env: deps.toolEnv, timeoutMs: INSTALL_TIMEOUT_MS })
		);
	}

	/**
	 * `POST /api/update/check`: fetch and report what an update would bring.
	 * While an apply runs it leaves the record alone — the apply's own states
	 * are fresher than a check's.
	 */
	async function check(): Promise<UpdateStatus> {
		const saved = await read();

		if (saved && APPLYING.has(saved.state)) return toStatus(saved);

		await write({ state: 'checking', error: undefined, blockedReason: undefined });

		try {
			const detectionResult = await detection();

			if (detectionResult.mode === 'managed') {
				await write({
					state: 'idle',
					mode: 'managed',
					current: { version: VERSION },
					available: null,
					managedNote: detectionResult.managedNote,
					pausedReviewIds: []
				});

				return status();
			}

			if (detectionResult.mode === 'binary') {
				const plan = await planUpgrade({ to: null, checkOnly: true }, await binaryProgram());

				const available: UpdateAvailable | null = plan.isNeeded
					? { version: plan.tag, commits: [], changes: { server: true, web: false, install: false } }
					: null;

				await write({ state: 'idle', mode: 'binary', current: { version: VERSION }, available, pausedReviewIds: [] });

				return status();
			}

			const repo = gitCheckout(environment.root, deps.run, deps.toolEnv);

			await repo.fetch();

			const inspection = await repo.inspect();
			const available = await gitAvailable(inspection);
			const current = { commit: inspection.commit, ...(inspection.branch ? { branch: inspection.branch } : {}) };

			await write({
				state: 'idle',
				mode: 'git',
				current,
				available,
				blockedReason: blockedReason(inspection),
				pausedReviewIds: []
			});
		} catch (error) {
			await write({ state: 'failed', error: errorMessage(error) });
		}

		return status();
	}

	/** What a git inspection says an update would bring, or null when there is nothing to pull. */
	async function gitAvailable(inspection: GitInspection): Promise<UpdateAvailable | null> {
		if (inspection.upstream === undefined || inspection.behind === 0) return null;

		return {
			commits: inspection.commits,
			changes: classifyPaths(inspection.paths, await readWorkspaceGraph(environment.root))
		};
	}

	/**
	 * `POST /api/update`: refuse what cannot apply, then run the rest in the
	 * background — the route answers at once and the UI polls the record.
	 */
	async function apply(): Promise<UpdateStatus> {
		const saved = await read();

		if (saved && APPLYING.has(saved.state)) throw new UpdateBusyError();
		if (saved?.blockedReason !== undefined) throw new UpdateRefusedError(saved.blockedReason);

		const detectionResult = await detection();

		if (detectionResult.mode === 'managed') {
			throw new UpdateRefusedError(
				detectionResult.managedNote ?? 'This deployment updates by redeploying, not in place.'
			);
		}

		await write({
			state: 'checking',
			mode: detectionResult.mode,
			error: undefined,
			blockedReason: undefined,
			webRestart: undefined,
			pausedReviewIds: []
		});

		void runApply(detectionResult.mode).catch(async (error: unknown) => {
			await write({ state: 'failed', error: errorMessage(error) });
		});

		return status();
	}

	async function runApply(mode: UpdateMode): Promise<void> {
		if (mode === 'binary') await applyBinary();
		else if (mode === 'git') await applyGit();
	}

	/**
	 * Fetch, re-inspect, then pull. Refusals (a dirty or diverged tree) are
	 * reported as `blockedReason` without touching reviews; a real failure
	 * resumes whatever was already paused and lands in 'failed'.
	 */
	async function applyGit(): Promise<void> {
		const repo = gitCheckout(environment.root, deps.run, deps.toolEnv);
		let pausedIds: string[] = [];
		let pulled = false;

		try {
			await repo.fetch();

			const inspection = await repo.inspect();
			const available = await gitAvailable(inspection);
			const blocked = blockedReason(inspection);
			const current = { commit: inspection.commit, ...(inspection.branch ? { branch: inspection.branch } : {}) };

			if (available === null || blocked !== undefined) {
				await write({ state: 'idle', current, available, blockedReason: blocked });

				return;
			}

			if (!available.changes.server) {
				await write({ state: 'updating', available });
				await repo.mergeFfOnly();
				pulled = true;
				if (available.changes.install) await installDependencies();

				await write({
					state: 'idle',
					available: null,
					webRestart: available.changes.web ? await detectWeb(environment.root) : undefined
				});

				return;
			}

			await write({ state: 'pausing', available });
			pausedIds = await pauseReviewsForUpdate();
			await write({ pausedReviewIds: pausedIds, state: 'updating' });
			await repo.mergeFfOnly();
			pulled = true;
			if (available.changes.install) await installDependencies();

			await write({
				state: 'restarting',
				webRestart: available.changes.web ? await detectWeb(environment.root) : undefined
			});

			restart();
		} catch (error) {
			await failBeforeRestart(pausedIds, error, pulled);
		}
	}

	/** The binary path: plan against the latest release, swap the executable, restart. */
	async function applyBinary(): Promise<void> {
		let pausedIds: string[] = [];
		let installed = false;

		try {
			const program = await binaryProgram();
			const plan = await planUpgrade({ to: null, checkOnly: true }, program);

			if (!plan.isNeeded) {
				await write({ state: 'idle', available: null });

				return;
			}

			const available: UpdateAvailable = {
				version: plan.tag,
				commits: [],
				changes: { server: true, web: false, install: false }
			};

			await write({ state: 'pausing', available });
			pausedIds = await pauseReviewsForUpdate();
			await write({ pausedReviewIds: pausedIds, state: 'updating' });
			await installRelease(plan.tag, program);
			installed = true;

			await write({ state: 'restarting' });
			restart();
		} catch (error) {
			await failBeforeRestart(pausedIds, error, installed);
		}
	}

	/**
	 * Anything before the restart went wrong: the paused reviews run again and
	 * the state lands on 'failed'. When the new code is already in place (the
	 * pull or the binary swap succeeded), the error says a restart finishes it.
	 */
	async function failBeforeRestart(pausedIds: string[], error: unknown, applied: boolean): Promise<void> {
		if (pausedIds.length) await resumeHeldReviews(pausedIds);
		else releaseReviewStarts();

		const message = applied
			? `${errorMessage(error)} The update is already in place; restart the server to finish it.`
			: errorMessage(error);

		await write({ state: 'failed', error: message, pausedReviewIds: [] });
	}

	return { status, check, apply };
}

export type UpdateService = ReturnType<typeof createUpdateService>;

/** The routes' service, bound to this machine. */
export const updateService = createUpdateService({ environment: localEnvironment(), run: spawnProcess });
