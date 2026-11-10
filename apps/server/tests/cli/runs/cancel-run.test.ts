import { expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { cancelRun } from '../../../src/cli/runs/cancel-run';
import { runFiles } from '../../../src/cli/runs/run-files';
import { newRecord, type RunRecord } from '../../../src/cli/runs/run-record';
import { isStopRequested } from '../../../src/cli/runs/stop-request';
import { COMPLETE, liveIdentity, runIdAt, storeRun, useFreshDataDir } from './run-fixtures';

const LAUNCHER_PID = 4001;

const BACKGROUND_PID = 4002;

useFreshDataDir();

/** Records the processes a cancel would signal, instead of signalling them. */
function recordStops() {
	const stopped: number[] = [];

	return { stopped, stop: (pid: number) => void stopped.push(pid) };
}

/** A running run's record as `cancel` reads it, held by the process `pid`. */
function runningRecord(pid: number): RunRecord {
	return newRecord({
		runId: runIdAt(1),
		pid,
		processStartedAt: '2026-11-10T10:00:00.000Z',
		repoPath: '/repo',
		targetKind: 'range',
		startedAt: '2026-11-10T10:00:00.000Z'
	});
}

/** The error `process.kill` throws for a process that has already ended. */
function noSuchProcess(): Error {
	return Object.assign(new Error('kill ESRCH'), { code: 'ESRCH' });
}

test('a running run whose process is proven to be the run is asked to stop', async () => {
	const identity = await liveIdentity();
	const { stopped, stop } = recordStops();

	await storeRun(runIdAt(1), identity);

	const status = await cancelRun(runIdAt(1), stop);

	expect(stopped).toEqual([identity.pid]);
	expect(status).toMatchObject({ state: 'running', stopRequested: true });
});

test('a live process that started at another time than the run is never signalled', async () => {
	const identity = await liveIdentity();
	const { stopped, stop } = recordStops();

	await storeRun(runIdAt(1), { ...identity, processStartedAt: '2001-01-01T00:00:00.000Z' });

	const status = await cancelRun(runIdAt(1), stop);

	expect(stopped).toEqual([]);
	expect(status).toMatchObject({ state: 'failed', stopRequested: false });
});

test('cancelling a finished run leaves it as it is', async () => {
	const { stopped, stop } = recordStops();

	await storeRun(runIdAt(1), { ...(await liveIdentity()), ...COMPLETE });

	const status = await cancelRun(runIdAt(1), stop);

	expect(stopped).toEqual([]);
	expect(status).toMatchObject({ state: 'complete', exitCode: 0, stopRequested: false });
});

/**
 * Cancels a run the launcher holds, whose record names the background process from the moment a stop reaches the
 * launcher; `launcherStopped` is what signalling the launcher does after that. Returns who was signalled.
 */
async function cancelDuringHandover(launcherStopped: () => void) {
	let current = runningRecord(LAUNCHER_PID);
	const stopped: number[] = [];

	await storeRun(runIdAt(1));

	const status = await cancelRun(
		runIdAt(1),
		(pid) => {
			stopped.push(pid);

			if (pid !== LAUNCHER_PID) return;

			current = runningRecord(BACKGROUND_PID);
			launcherStopped();
		},
		async () => current
	);

	return { stopped, stopRequested: status.stopRequested };
}

test('a stop that reached the launcher as it handed the run over is not sent again to the background process', async () => {
	expect(await cancelDuringHandover(() => {})).toEqual({ stopped: [LAUNCHER_PID], stopRequested: true });
});

test('a stop that found the launcher gone goes once to the background process that holds the run', async () => {
	const handover = await cancelDuringHandover(() => {
		throw noSuchProcess();
	});

	expect(handover).toEqual({ stopped: [LAUNCHER_PID, BACKGROUND_PID], stopRequested: true });
});

test('a cancel stores its stop request in the run’s folder before it signals the run’s process', async () => {
	const requestedWhenSignalled: boolean[] = [];

	await storeRun(runIdAt(1), await liveIdentity());
	await cancelRun(runIdAt(1), () => void requestedWhenSignalled.push(existsSync(runFiles(runIdAt(1)).stopRequest)));

	expect(requestedWhenSignalled).toEqual([true]);
});

test('a cancel stores its stop request before it checks which process holds the run', async () => {
	const storedWhenChecked: boolean[] = [];

	await storeRun(runIdAt(1));

	await cancelRun(
		runIdAt(1),
		() => {},
		async () => {
			storedWhenChecked.push(existsSync(runFiles(runIdAt(1)).stopRequest));

			return runningRecord(BACKGROUND_PID);
		}
	);

	expect(storedWhenChecked).not.toContain(false);
});

test('a stop that cannot be sent takes its request back, so it does not act later', async () => {
	await storeRun(runIdAt(1), await liveIdentity());

	const refused = cancelRun(runIdAt(1), () => {
		throw new Error('the run is still starting in this server');
	});

	await expect(refused).rejects.toThrow('still starting');
	expect(await isStopRequested(runIdAt(1))).toBe(false);
});
