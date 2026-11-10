import { describeError } from '../exit.js';
import { writeStderrLine } from '../output/streams.js';
import { runStartedAt } from './run-id.js';
import { listRuns } from './run-list.js';
import { removeRunFolder } from './run-files.js';
import type { UnreadableRunError } from './run-record.js';

/** How many finished runs are kept; older ones are removed when a run starts. */
const KEPT_FINISHED_RUNS = 50;

/**
 * How long a run whose record cannot be read is kept, counted from the start time in its id. Longer than any review
 * runs, so a run that a newer version of recoder is still writing is never removed under it.
 */
const KEPT_UNREADABLE_MS = 24 * 60 * 60 * 1000;

/**
 * Removes all but the newest finished runs, and runs whose record cannot be read once they are a day old. A running
 * run is never removed, nor is a run with no record yet, since that is a run another process is creating. Two
 * processes pruning at once remove the same folders, which is harmless. Pruning is housekeeping: a failure is said on
 * standard error and the new run goes on.
 */
export async function pruneFinishedRuns(): Promise<void> {
	try {
		await removeOldRuns();
	} catch (error) {
		writeStderrLine(`recoder: cannot remove old runs: ${describeError(error)}`);
	}
}

async function removeOldRuns(): Promise<void> {
	const { runs, unreadable } = await listRuns();
	const finished = runs.filter((run) => run.state !== 'running');

	for (const run of finished.slice(KEPT_FINISHED_RUNS)) await removeRunFolder(run.runId);

	for (const problem of unreadable.filter(isOld)) await removeRunFolder(problem.runId);
}

function isOld(problem: UnreadableRunError): boolean {
	return Date.now() - runStartedAt(problem.runId).getTime() > KEPT_UNREADABLE_MS;
}
