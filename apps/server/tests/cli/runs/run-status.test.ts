import { expect, test } from 'bun:test';
import { writeFileSync } from 'node:fs';
import { EXIT } from '../../../src/cli/exit';
import { runFiles } from '../../../src/cli/runs/run-files';
import { listRuns } from '../../../src/cli/runs/run-list';
import { readRunRecord, UnreadableRunError, type RunRecord } from '../../../src/cli/runs/run-record';
import { readRunStatus, settleRun } from '../../../src/cli/runs/run-status';
import { COMPLETE, goneIdentity, liveIdentity, runIdAt, storeRun, useFreshDataDir } from './run-fixtures';

useFreshDataDir();

test('a record read back from disk equals the record written', async () => {
	const written = await storeRun(runIdAt(1), { ...COMPLETE, stage: 'reviewing', findings: 3 });

	expect(await readRunRecord(written.runId, runFiles(written.runId))).toEqual(written);
});

test('a running run whose process is alive reads as running', async () => {
	const runId = runIdAt(1);

	await storeRun(runId, await liveIdentity());

	expect((await readRunStatus(runId)).state).toBe('running');
});

test('a running run whose process is gone reads as failed with a plain error', async () => {
	const runId = runIdAt(1);

	await storeRun(runId, await goneIdentity());

	const status = await readRunStatus(runId);

	expect(status.state).toBe('failed');
	expect(status.exitCode).toBe(EXIT.failed);
	expect(status.error).toBe('the process ended without finishing');
});

test('a running run whose id now belongs to a process started at another time reads as failed', async () => {
	const runId = runIdAt(1);
	const identity = await liveIdentity();

	await storeRun(runId, { ...identity, processStartedAt: '2001-01-01T00:00:00.000Z' });

	expect((await readRunStatus(runId)).state).toBe('failed');
});

test('a cut-short run.json is an error for that run', async () => {
	const runId = runIdAt(1);

	await storeRun(runId, COMPLETE);
	writeFileSync(runFiles(runId).record, '{"schemaVersion":1,"runId":');

	await expect(readRunStatus(runId)).rejects.toBeInstanceOf(UnreadableRunError);
});

test('a record that names process 1 is unreadable, so nothing can ever signal init', async () => {
	const runId = runIdAt(1);

	await storeRun(runId, { pid: 1 });

	await expect(readRunStatus(runId)).rejects.toBeInstanceOf(UnreadableRunError);
});

test('an unreadable run is reported apart and the other runs are still listed, newest first', async () => {
	await storeRun(runIdAt(1), COMPLETE);
	await storeRun(runIdAt(2), COMPLETE);
	await storeRun(runIdAt(3), COMPLETE);
	writeFileSync(runFiles(runIdAt(2)).record, '{"state":"bogus"}');

	const { runs, unreadable } = await listRuns();

	expect(runs.map((run) => run.runId)).toEqual([runIdAt(3), runIdAt(1)]);
	expect(unreadable.map((problem) => problem.message)).toEqual([expect.stringContaining(runIdAt(2))]);
});

test('an id with no run is a usage error naming it', async () => {
	await expect(readRunStatus(runIdAt(9))).rejects.toMatchObject({
		exitCode: EXIT.usage,
		message: expect.stringContaining(runIdAt(9))
	});
});

test('a run read just before its launcher handed it over and exited reads as running under the new process', async () => {
	const handedOver = await storeRun(runIdAt(1), await liveIdentity());
	const readBeforeHandover = { ...handedOver, ...(await goneIdentity()) };

	expect(await settleRun(readBeforeHandover)).toEqual(handedOver);
});

test('a run read just before its process wrote its end and exited reads as ended, not failed', async () => {
	const ended = await storeRun(runIdAt(1), { ...(await liveIdentity()), ...COMPLETE });
	const readBeforeEnd: RunRecord = { ...ended, state: 'running', ...(await goneIdentity()) };

	expect(await settleRun(readBeforeEnd)).toEqual(ended);
});
