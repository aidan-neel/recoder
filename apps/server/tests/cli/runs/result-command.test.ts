import { expect, test } from 'bun:test';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { EXIT } from '../../../src/cli/exit';
import type { OutputOptions } from '../../../src/cli/review/options';
import { printRunResult } from '../../../src/cli/runs/result-command';
import { runFiles } from '../../../src/cli/runs/run-files';
import type { RunRecord } from '../../../src/cli/runs/run-record';
import { saveReport } from '../../../src/cli/runs/stored-report';
import { OUTPUT, destination, finding, report } from '../output/fixtures';
import { COMPLETE, liveIdentity, runIdAt, storeRun, useFreshDataDir } from './run-fixtures';

useFreshDataDir();

const SILENT = destination();

const ENDED_WITHOUT_REPORT: Partial<RunRecord> = { ...COMPLETE, state: 'failed', findings: null, unconfirmed: null };

const WITH_WARNING = report({ findings: [finding({ severity: 'warning' })] });

async function storeFinishedRun(stored: Parameters<typeof saveReport>[1]) {
	const runId = runIdAt(1);

	await storeRun(runId, COMPLETE);
	await saveReport(runFiles(runId), stored);

	return runId;
}

function resultExitCode(runId: ReturnType<typeof runIdAt>, failOn: OutputOptions['failOn']) {
	return printRunResult(runId, { ...OUTPUT, failOn }, SILENT);
}

test('a stored report exits as a foreground review would for each --fail-on', async () => {
	const runId = await storeFinishedRun(WITH_WARNING);

	expect(await resultExitCode(runId, 'never')).toBe(EXIT.ok);
	expect(await resultExitCode(runId, 'info')).toBe(EXIT.findings);
	expect(await resultExitCode(runId, 'warning')).toBe(EXIT.findings);
	expect(await resultExitCode(runId, 'error')).toBe(EXIT.ok);
});

test('a stored report of a failed or cancelled review exits as that review did', async () => {
	const failed = await storeFinishedRun(report({ outcome: 'failed', error: 'model timed out' }));

	expect(await resultExitCode(failed, 'never')).toBe(EXIT.failed);
});

test('a run that ended without a report exits with the code it recorded', async () => {
	await storeRun(runIdAt(1), { ...ENDED_WITHOUT_REPORT, exitCode: EXIT.notReady, error: 'no model' });

	expect(await resultExitCode(runIdAt(1), 'never')).toBe(EXIT.notReady);
});

test('a finished run whose report is missing fails instead of exiting 0 with nothing', async () => {
	await storeRun(runIdAt(1), COMPLETE);

	await expect(resultExitCode(runIdAt(1), 'never')).rejects.toMatchObject({ exitCode: EXIT.failed });
});

test('--output into a folder that does not exist yet creates it, as recoder review does', async () => {
	const runId = await storeFinishedRun(WITH_WARNING);
	const file = join(mkdtempSync(join(tmpdir(), 'recoder-result-')), 'new-folder', 'report.json');
	const toDisk = destination({ writeFile: (path, text) => writeFile(path, text) });

	await printRunResult(runId, { ...OUTPUT, file }, toDisk);

	expect(existsSync(file)).toBe(true);
	rmSync(dirname(dirname(file)), { recursive: true });
});

test('a run that is still running is a usage error', async () => {
	await storeRun(runIdAt(1), await liveIdentity());

	await expect(resultExitCode(runIdAt(1), 'never')).rejects.toMatchObject({ exitCode: EXIT.usage });
});
