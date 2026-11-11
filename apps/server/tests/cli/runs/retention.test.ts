import { expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { pruneFinishedRuns } from '../../../src/cli/runs/retention';
import { createRunId, parseRunId, type RunId } from '../../../src/cli/runs/run-id';
import { createRunFolder, runFiles } from '../../../src/cli/runs/run-files';
import { listRuns } from '../../../src/cli/runs/run-list';
import { COMPLETE, liveIdentity, runIdAt, storeRun, useFreshDataDir } from './run-fixtures';

useFreshDataDir();

const KEPT = 50;

const EXTRA = 3;

test('pruning keeps every running run and the newest finished runs, and removes older finished ones', async () => {
	await storeRun(runIdAt(0), await liveIdentity());

	for (let index = 1; index <= KEPT + EXTRA; index++) await storeRun(runIdAt(index), COMPLETE);

	await pruneFinishedRuns();

	const kept = (await listRuns()).runs.map((run) => run.runId);

	expect(kept).toHaveLength(KEPT + 1);
	expect(kept).toContain(runIdAt(0));
	expect(kept).toContain(runIdAt(KEPT + EXTRA));
	expect(kept).not.toContain(runIdAt(EXTRA));
	expect(kept).toContain(runIdAt(EXTRA + 1));
});

/** A run whose record was cut short, which no command can read. */
async function storeUnreadableRun(runId: RunId): Promise<void> {
	await writeFile((await createRunFolder(runId)).record, '{"schemaVersion":');
}

test('a run whose record cannot be read is removed once its id says it started more than a day ago', async () => {
	const runId = parseRunId('20010101-000000-abcdef');

	await storeUnreadableRun(runId);
	await pruneFinishedRuns();

	expect(existsSync(runFiles(runId).folder)).toBe(false);
});

test('a run whose record cannot be read is kept while it started less than a day ago', async () => {
	const runId = createRunId(new Date());

	await storeUnreadableRun(runId);
	await pruneFinishedRuns();

	expect(existsSync(runFiles(runId).folder)).toBe(true);
});
