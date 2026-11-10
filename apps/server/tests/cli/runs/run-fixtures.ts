import { afterEach, beforeEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { currentProcessIdentity, type ProcessIdentity } from '../../../src/cli/runs/process-identity';
import { parseRunId, type RunId } from '../../../src/cli/runs/run-id';
import { createRunFolder } from '../../../src/cli/runs/run-files';
import { newRecord, writeRunRecord, type RunRecord } from '../../../src/cli/runs/run-record';
import { childEnvironment, testDataDir } from '../child-env';

const FIRST_SECOND = 100_000;

/** Gives each test its own empty data directory, so runs never leak between tests, and puts the old one back. */
export function useFreshDataDir(): void {
	const previous = process.env.RECODER_DATA_DIR;
	let directory = '';

	beforeEach(() => {
		directory = mkdtempSync(join(tmpdir(), 'recoder-runs-'));
		process.env.RECODER_DATA_DIR = directory;
	});

	afterEach(() => {
		rmSync(directory, { recursive: true, force: true });
		process.env.RECODER_DATA_DIR = previous;
	});
}

/** A run id that sorts after every id with a smaller `index`. */
export function runIdAt(index: number): RunId {
	return parseRunId(`20261110-${FIRST_SECOND + index}-abcdef`);
}

/** Writes a run's folder and record, as a run would have. */
export async function storeRun(runId: RunId, overrides: Partial<RunRecord> = {}): Promise<RunRecord> {
	const files = await createRunFolder(runId);

	const record: RunRecord = {
		...newRecord({
			runId,
			pid: process.pid,
			processStartedAt: '2026-11-10T10:00:00.000Z',
			repoPath: '/repo',
			targetKind: 'range',
			startedAt: '2026-11-10T10:00:00.000Z'
		}),
		...overrides
	};

	await writeRunRecord(files, record);

	return record;
}

/** A finished run's fields. */
export const COMPLETE: Partial<RunRecord> = {
	state: 'complete',
	exitCode: 0,
	finishedAt: '2026-11-10T10:05:00.000Z',
	findings: 0,
	unconfirmed: 0
};

/** This test process, which is alive for as long as the test runs. */
export function liveIdentity(): Promise<ProcessIdentity> {
	return currentProcessIdentity();
}

/** The identity of a process that has ended and been reaped. */
export async function goneIdentity(): Promise<ProcessIdentity> {
	const child = Bun.spawn(['true'], { env: childEnvironment(testDataDir()), stdio: ['ignore', 'ignore', 'ignore'] });

	await child.exited;

	return { pid: child.pid, processStartedAt: '2026-11-10T10:00:00.000Z' };
}
