import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { EXIT } from '../../../src/cli/exit';
import { runFiles } from '../../../src/cli/runs/run-files';
import { RunJournal } from '../../../src/cli/runs/run-journal';
import { readRunRecord } from '../../../src/cli/runs/run-record';
import { liveIdentity, runIdAt, storeRun, useFreshDataDir } from './run-fixtures';

useFreshDataDir();

test('a run id passed by hand cannot take over a run this process was not handed', async () => {
	const identity = await liveIdentity();

	await storeRun(runIdAt(1), identity);

	await expect(RunJournal.takeOver(runIdAt(1))).rejects.toMatchObject({ exitCode: EXIT.usage });
	expect(await readRunRecord(runIdAt(1), runFiles(runIdAt(1)))).toMatchObject({ pid: identity.pid });
});

test('the stage the review reports reaches the record, and every event reaches the progress file', async () => {
	const journal = await RunJournal.create({ repoPath: '/repo', targetKind: 'staged' });

	const progress = journal.progressSink();

	progress({ type: 'stage', stage: 'reviewing' });
	progress({ type: 'log', message: 'reading src/a.ts' });
	await journal.finish({ state: 'complete', exitCode: EXIT.ok, error: null, findings: 0, unconfirmed: 0 });

	expect(await readRunRecord(journal.runId, runFiles(journal.runId))).toMatchObject({ stage: 'reviewing' });
	expect(readFileSync(runFiles(journal.runId).progress, 'utf8').trim().split('\n')).toHaveLength(2);
});
