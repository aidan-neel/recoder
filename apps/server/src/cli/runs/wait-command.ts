import { EXIT, type ExitCode } from '../exit.js';
import { abortOnSignal } from '../signals/abort-on-signal.js';
import { writeJsonLine } from './json-line.js';
import type { RunId } from './run-id.js';
import { SYSTEM_CLOCK, waitForRun } from './wait-for-run.js';

/**
 * `recoder wait <run-id>`: exits 0 whether the run ended or the timeout passed, so the caller reads `state`. A signal
 * ends the wait, not the run, and exits as cancelled.
 */
export async function runWaitCommand(runId: RunId, timeoutMs: number | null): Promise<ExitCode> {
	const signal = abortOnSignal();
	const status = await waitForRun({ runId, timeoutMs, signal, clock: SYSTEM_CLOCK });

	await writeJsonLine(status);

	return signal.aborted ? EXIT.cancelled : EXIT.ok;
}
