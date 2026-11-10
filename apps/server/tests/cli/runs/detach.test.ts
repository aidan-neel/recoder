import { afterEach, expect, test } from 'bun:test';
import type { Subprocess } from 'bun';
import { existsSync, mkdirSync, watch } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { backgroundFlags } from '../../../src/cli/args/launch';
import { EXIT } from '../../../src/cli/exit';
import { cancelRun, type CancelStatus } from '../../../src/cli/runs/cancel-run';
import { detachReview, type DetachRequest } from '../../../src/cli/runs/detach';
import { isRunId, type RunId } from '../../../src/cli/runs/run-id';
import { runFiles, runsRoot } from '../../../src/cli/runs/run-files';
import { readRunStatus, type RunStatus } from '../../../src/cli/runs/run-status';
import { signalExitCode } from '../../../src/cli/signals/exit-on-signal';
import { childEnvironment, testDataDir } from '../child-env';
import { withPipe } from '../program-launch';
import { openGate, waitingFile } from './fake-review';
import { useFreshDataDir } from './run-fixtures';

const FIXTURE = new URL('./background-fixture.ts', import.meta.url).pathname;

const LAUNCHER_FIXTURE = new URL('./launcher-fixture.ts', import.meta.url).pathname;

/** Longer than any fixture needs to start, and shorter than the test's own limit, so the launcher always returns. */
const HANDOVER_TIMEOUT_MS = 15_000;

const TEST_TIMEOUT_MS = 40_000;

const REVIEW_FLAGS = ['--diff', 'change.patch', '--progress', 'none'];

/** Every process a test starts, so the test after it can stop and reap each one. */
const started: Subprocess[] = [];

afterEach(async () => {
	for (const child of started.splice(0)) {
		if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');

		await child.exited;
	}
});

/** Registered after the hook above, which runs first: a child still alive would write into a folder already removed. */
useFreshDataDir();

/** Starts the background fixture as `--detach` does, in its own session, with only the test's own variables. */
function spawnFixture(command: string[], log: number): Subprocess {
	const child = Bun.spawn(command, {
		stdio: ['ignore', 'ignore', log],
		detached: true,
		env: childEnvironment(testDataDir())
	});

	started.push(child);

	return child;
}

/** What a test changes about a start: the stop the launcher receives, and what it does once the run exists. */
interface FixtureStart {
	signal?: AbortSignal;
	onRunCreated?: (runId: RunId) => void;
}

function detachFixture(mode: string, start: FixtureStart = {}) {
	const request: DetachRequest = {
		run: { repoPath: '/repo', targetKind: 'diff' },
		command: (runId) => ['bun', FIXTURE, mode, ...backgroundFlags(runId, REVIEW_FLAGS)],
		signal: start.signal ?? new AbortController().signal,
		handoverTimeoutMs: HANDOVER_TIMEOUT_MS,
		spawn: spawnFixture,
		onRunCreated: start.onRunCreated
	};

	return detachReview(request);
}

/** Resolves with what `find` finds, trying again each time something in `folder` changes. */
function whenFound<T>(folder: string, find: () => Promise<T | null>): Promise<T> {
	return new Promise((resolve, reject) => {
		const check = (): void => {
			find().then(
				(found) => {
					if (found === null) return;

					watcher.close();
					resolve(found);
				},
				(error: unknown) => {
					watcher.close();
					reject(error);
				}
			);
		};

		const watcher = watch(folder, check);

		check();
	});
}

/** The run's status once it has ended. */
function untilEnded(runId: RunId): Promise<RunStatus> {
	return whenFound(runFiles(runId).folder, async () => {
		const status = await readRunStatus(runId);

		return status.state === 'running' ? null : status;
	});
}

/** The id of the one run a launcher process creates, once its gated background process waits to take it over. */
async function untilBackgroundWaits(): Promise<RunId> {
	mkdirSync(runsRoot(), { recursive: true });

	const runId = await whenFound(runsRoot(), async () => (await readdir(runsRoot())).find(isRunId) ?? null);

	await whenFound(runFiles(runId).folder, async () => (existsSync(waitingFile(runId)) ? true : null));

	return runId;
}

test(
	'--detach returns while the background run goes on, and status and cancel work at once',
	async () => {
		const { status, outcome } = await detachFixture('until-cancelled');

		expect(outcome).toBe('started');
		expect(status.logFile).toBe(runFiles(status.runId).log);
		expect((await readRunStatus(status.runId)).state).toBe('running');
		expect(await cancelRun(status.runId, (pid) => process.kill(pid, 'SIGTERM'))).toMatchObject({ stopRequested: true });

		expect(await untilEnded(status.runId)).toMatchObject({
			state: 'cancelled',
			exitCode: EXIT.cancelled,
			stage: 'reviewing'
		});
	},
	TEST_TIMEOUT_MS
);

test(
	'a background process that exits before taking the run over leaves the run not started and failed',
	async () => {
		const { status, outcome } = await detachFixture('crash');

		expect(outcome).toBe('not-started');
		expect(status).toMatchObject({ state: 'failed', exitCode: EXIT.failed });
	},
	TEST_TIMEOUT_MS
);

test(
	'a stop before the handover stops the child, waits for it, and records the run cancelled',
	async () => {
		const controller = new AbortController();

		controller.abort();

		const { status, outcome } = await detachFixture('hold', { signal: controller.signal });

		expect(outcome).toBe('cancelled');
		expect(status).toMatchObject({ state: 'cancelled', exitCode: EXIT.cancelled });
		expect(started[0].signalCode).toBe('SIGTERM');
	},
	TEST_TIMEOUT_MS
);

test(
	'a stop after the handover is passed on to the background review, which records its own cancel',
	async () => {
		const controller = new AbortController();
		const { status, outcome } = await detachFixture('until-cancelled', { signal: controller.signal });

		expect(outcome).toBe('started');

		controller.abort();

		expect(await started[0].exited).toBe(EXIT.cancelled);
		expect(await readRunStatus(status.runId)).toMatchObject({ state: 'cancelled', exitCode: EXIT.cancelled });
	},
	TEST_TIMEOUT_MS
);

test(
	'a cancel whose signal the launcher never passes on still ends the run cancelled once it is taken over',
	async () => {
		const signalled: number[] = [];
		let cancelling: Promise<CancelStatus> | null = null;

		const { status, outcome } = await detachFixture('gate', {
			onRunCreated: (runId) => {
				cancelling = cancelRun(runId, (pid) => void signalled.push(pid)).finally(() => openGate(runId));
			}
		});

		expect(outcome).toBe('started');
		expect(await cancelling).toMatchObject({ stopRequested: true });
		expect(signalled).toEqual([process.pid]);
		expect(await untilEnded(status.runId)).toMatchObject({ state: 'cancelled', exitCode: EXIT.cancelled });
	},
	TEST_TIMEOUT_MS
);

test(
	'once a run has recorded its end, one stop ends its process while a reader holds up the report',
	async () => {
		const { status } = await detachFixture('stuck-output');

		expect(await untilEnded(status.runId)).toMatchObject({ state: 'complete', exitCode: EXIT.ok });

		started[0].kill('SIGTERM');

		expect(await started[0].exited).toBe(signalExitCode('SIGTERM'));
	},
	TEST_TIMEOUT_MS
);

test(
	'a hang-up while --detach hands its run over cancels nothing, and a launcher whose output is gone still ends',
	async () => {
		await withPipe(async (stdout) => {
			const launcher = Bun.spawn(['bun', LAUNCHER_FIXTURE, 'review', '--detach', ...REVIEW_FLAGS], {
				env: childEnvironment(testDataDir()),
				stdio: ['ignore', stdout.writer, 'ignore']
			});

			started.push(launcher);

			const runId = await untilBackgroundWaits();

			launcher.kill('SIGHUP');
			stdout.closeReader();
			openGate(runId);

			expect(await launcher.exited).toBe(EXIT.failed);
			expect((await readRunStatus(runId)).state).toBe('running');

			await cancelRun(runId, (pid) => process.kill(pid, 'SIGTERM'));
			expect(await untilEnded(runId)).toMatchObject({ state: 'cancelled' });
		});
	},
	TEST_TIMEOUT_MS
);
