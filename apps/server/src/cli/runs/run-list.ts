import { readdir } from 'node:fs/promises';
import { errorCode } from '../exit.js';
import { isRunId, type RunId } from './run-id.js';
import { runFiles, runsRoot } from './run-files.js';
import { readRunRecord, UnreadableRunError, type RunRecord } from './run-record.js';
import { settleRun } from './run-status.js';

/** Every run on disk, newest first, settled; and the runs whose record could not be read. */
export interface RunListing {
	runs: RunRecord[];
	unreadable: UnreadableRunError[];
}

/**
 * Reads every run. A folder with no record yet is a run still being created, and one that vanished was removed by
 * another process's pruning; both are left out. A record that cannot be read is reported apart, so one bad run does
 * not hide the others.
 */
export async function listRuns(): Promise<RunListing> {
	const listing: RunListing = { runs: [], unreadable: [] };

	for (const runId of await listRunIds()) {
		const entry = await readListedRun(runId);

		if (entry instanceof UnreadableRunError) listing.unreadable.push(entry);
		else if (entry !== null) listing.runs.push(entry);
	}

	return listing;
}

/** The ids of every run folder, newest first. Folders that are not runs are ignored. */
export async function listRunIds(): Promise<RunId[]> {
	const names = await readFolderNames(runsRoot());

	return names.filter(isRunId).sort().reverse();
}

async function readFolderNames(folder: string): Promise<string[]> {
	try {
		return await readdir(folder);
	} catch (error) {
		if (errorCode(error) === 'ENOENT') return [];

		throw error;
	}
}

async function readListedRun(runId: RunId): Promise<RunRecord | UnreadableRunError | null> {
	try {
		const record = await readRunRecord(runId, runFiles(runId));

		return record === null ? null : await settleRun(record);
	} catch (error) {
		if (error instanceof UnreadableRunError) return error;

		throw error;
	}
}
