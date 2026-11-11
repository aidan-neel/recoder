import { expect, test } from 'bun:test';
import { runFiles } from '../../../src/cli/runs/run-files';
import { writeRunRecord, type RunRecord } from '../../../src/cli/runs/run-record';
import { waitForRun, type WaitClock } from '../../../src/cli/runs/wait-for-run';
import { COMPLETE, liveIdentity, runIdAt, storeRun, useFreshDataDir } from './run-fixtures';

useFreshDataDir();

const MINUTE_MS = 60_000;

/** A clock that moves only when the wait sleeps, and runs `onSleep` each time it does. */
function fakeClock(onSleep: () => Promise<void> = async () => {}) {
	let now = 0;
	let sleeps = 0;

	const clock: WaitClock = {
		now: () => now,
		sleep: async (ms) => {
			now += ms;
			sleeps += 1;
			await onSleep();
		}
	};

	return { clock, sleeps: () => sleeps };
}

async function storeRunningRun(): Promise<RunRecord> {
	return storeRun(runIdAt(1), await liveIdentity());
}

test('waiting returns the finished status once the run ends', async () => {
	const running = await storeRunningRun();
	const { clock, sleeps } = fakeClock(() => writeRunRecord(runFiles(running.runId), { ...running, ...COMPLETE }));

	const status = await waitForRun({
		runId: running.runId,
		timeoutMs: null,
		signal: new AbortController().signal,
		clock
	});

	expect(status.state).toBe('complete');
	expect(sleeps()).toBe(1);
});

test('waiting returns the running status when the timeout passes first', async () => {
	const running = await storeRunningRun();
	const { clock } = fakeClock();

	const status = await waitForRun({
		runId: running.runId,
		timeoutMs: MINUTE_MS,
		signal: new AbortController().signal,
		clock
	});

	expect(status.state).toBe('running');
	expect(clock.now()).toBe(MINUTE_MS);
});

test('an aborted wait returns at once and leaves the run running', async () => {
	const running = await storeRunningRun();
	const controller = new AbortController();
	const { clock } = fakeClock(async () => controller.abort());

	const status = await waitForRun({ runId: running.runId, timeoutMs: null, signal: controller.signal, clock });

	expect(status.state).toBe('running');
});
