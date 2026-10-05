import { expect, test } from 'bun:test';
import type { ReviewRun } from '../../../../src/review/pipeline/harness/context';
import { checksInTime } from '../../../../src/review/pipeline/harness/sandbox-setup';

/** A run with only what the wait reads: its abort controller and the task rows it writes. */
function runStub(): { run: ReviewRun; statuses: string[] } {
	const statuses: string[] = [];

	const run = {
		controller: new AbortController(),
		task: (_id: string, _title: string, status: string) => statuses.push(status)
	} as unknown as ReviewRun;

	return { run, statuses };
}

const NEVER = new Promise<void>(() => {});

test('checks that finish within the grace are in time', async () => {
	const { run, statuses } = runStub();

	expect(await checksInTime(run, Promise.resolve(), 50)).toBe(true);
	expect(statuses).toEqual([]);
});

test('checks still running after the grace are left behind and their row says so', async () => {
	const { run, statuses } = runStub();

	expect(await checksInTime(run, NEVER, 5)).toBe(false);
	expect(statuses).toEqual(['partial']);
});

test('a cancelled review stops waiting for checks without touching their row', async () => {
	const { run, statuses } = runStub();

	run.controller.abort();

	expect(await checksInTime(run, NEVER, 10_000)).toBe(false);
	expect(statuses).toEqual([]);
});
