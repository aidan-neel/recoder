import { errorCode } from '../exit.js';
import type { RunId } from './run-id.js';
import type { RunRecord } from './run-record.js';
import { describeRun, readRun, settleRun, type RunStatus } from './run-status.js';
import { requestStop, withdrawStop } from './stop-request.js';

/** A run's status after `recoder cancel`, with whether a stop was sent. */
export type CancelStatus = RunStatus & { stopRequested: boolean };

/** Reads a run's record as it stands, its process proven or the run settled as failed. */
type SettledRunReader = (runId: RunId) => Promise<RunRecord>;

/**
 * A run changes process once, when `recoder review --detach` hands it to the background process. The launcher passes
 * every stop it receives on to that process, so a stop that reached it is never sent again: a second one would make
 * the review exit at once, without its cleanup. Only a stop that found the process gone is sent again, to the
 * process the record names by then.
 */
const STOP_ROUNDS = 2;

/**
 * Asks a running run's process to stop, through `stop` (SIGTERM in the command). The request is stored in the run's
 * folder first and the signal only wakes the process, so a launcher that does not pass the signal on loses nothing
 * (`stop-request.ts`). The request goes in before any process is checked: a handover that completes while the
 * launcher is checked then still meets it. The process is then proven to be the run's: the same id and the same start
 * time. A process that fails that proof is not signalled, and the run reads as failed. A run whose record says it is
 * not running is left as it is.
 */
export async function cancelRun(
	runId: RunId,
	stop: (pid: number) => void,
	readSettled: SettledRunReader = readSettledRun
): Promise<CancelStatus> {
	const written = await readRun(runId);

	if (written.state !== 'running') return withStop(written, false);

	await requestStop(runId);

	for (let round = 0; round < STOP_ROUNDS; round++) {
		const record = await readSettled(runId);

		if (record.state !== 'running') return withStop(record, false);

		if (await sendStop(runId, record.pid, stop)) return withStop(record, true);
	}

	return withStop(await readSettled(runId), false);
}

async function readSettledRun(runId: RunId): Promise<RunRecord> {
	return settleRun(await readRun(runId));
}

/** Sends the stop; false when the process ended before it arrived. A stop that fails otherwise withdraws the request. */
async function sendStop(runId: RunId, pid: number, stop: (pid: number) => void): Promise<boolean> {
	try {
		stop(pid);

		return true;
	} catch (error) {
		if (errorCode(error) === 'ESRCH') return false;

		await withdrawStop(runId);

		throw error;
	}
}

async function withStop(record: RunRecord, isRequested: boolean): Promise<CancelStatus> {
	return { ...(await describeRun(record)), stopRequested: isRequested };
}
