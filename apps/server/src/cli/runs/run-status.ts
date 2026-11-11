import { access } from 'node:fs/promises';
import { errorCode, EXIT, usageError } from '../exit.js';
import { isSameProcess } from './process-identity.js';
import type { RunId } from './run-id.js';
import { runFiles } from './run-files.js';
import { readRunRecord, type RunRecord } from './run-record.js';

const PROCESS_GONE = 'the process ended without finishing';

/**
 * A run as every command prints it: `status`, `wait`, `cancel`, each element of `runs`, and the `--detach` line.
 * `reportFile` and `logFile` are null until the file exists; a foreground run has no log file.
 */
export type RunStatus = Omit<RunRecord, 'pid' | 'processStartedAt'> & {
	reportFile: string | null;
	logFile: string | null;
};

/** The run's status; an id with no run is a usage error naming it. */
export async function readRunStatus(runId: RunId): Promise<RunStatus> {
	return describeRun(await settleRun(await readRun(runId)));
}

/** The run's record as written; an id with no run is a usage error naming it. */
export async function readRun(runId: RunId): Promise<RunRecord> {
	const record = await readRunRecord(runId, runFiles(runId));

	if (record === null) throw usageError(`no run ${runId}; run recoder runs to list them.`);

	return record;
}

/**
 * The record as it stands: one that says `running` whose process is gone, or is now another process, ended without
 * writing its end, so it reads as failed rather than running forever. A record read just before its process handed
 * the run over, or wrote its end, and exited names a process that is gone though the run is not. Both are written
 * before that process exits, so the record is read again before the run is called failed.
 */
export async function settleRun(record: RunRecord): Promise<RunRecord> {
	if (record.state !== 'running' || (await isSameProcess(record))) return record;

	const current = await readRunRecord(record.runId, runFiles(record.runId));

	if (current === null || hasSameOwner(current, record)) return asProcessGone(record);

	if (current.state !== 'running' || (await isSameProcess(current))) return current;

	return asProcessGone(current);
}

function hasSameOwner(current: RunRecord, earlier: RunRecord): boolean {
	return (
		current.state === 'running' && current.pid === earlier.pid && current.processStartedAt === earlier.processStartedAt
	);
}

function asProcessGone(record: RunRecord): RunRecord {
	return { ...record, state: 'failed', exitCode: EXIT.failed, error: PROCESS_GONE };
}

/** The status printed for a settled record. The process identity stays internal: it means nothing to a caller. */
export async function describeRun(record: RunRecord): Promise<RunStatus> {
	const { pid: _pid, processStartedAt: _processStartedAt, ...fields } = record;
	const files = runFiles(record.runId);

	return {
		...fields,
		reportFile: await pathIfPresent(files.report),
		logFile: await pathIfPresent(files.log)
	};
}

async function pathIfPresent(path: string): Promise<string | null> {
	try {
		await access(path);

		return path;
	} catch (error) {
		if (errorCode(error) === 'ENOENT') return null;

		throw error;
	}
}
