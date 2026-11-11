import { EXIT, type ExitCode } from '../exit.js';
import { printResult } from '../output/print-result.js';
import { abortOnSignal } from '../signals/abort-on-signal.js';
import type { Terminal } from '../terminal/terminal.js';
import { followRun } from './follow-run.js';
import { resolveRunReference, type RunReference } from './run-reference.js';
import { statusView } from './run-view.js';
import { SYSTEM_CLOCK, waitForRun, type WaitRequest } from './wait-for-run.js';

/**
 * `recoder wait [run]`: exits 0 whether the run ended or the timeout passed, so a program reads `state`. A person
 * watching a terminal sees the review's progress while it waits. A signal ends the wait, not the run, and exits as
 * cancelled.
 */
export async function runWaitCommand(
	run: RunReference,
	timeoutMs: number | null,
	terminal: Terminal
): Promise<ExitCode> {
	const signal = abortOnSignal();
	const request: WaitRequest = { runId: await resolveRunReference(run), timeoutMs, signal, clock: SYSTEM_CLOCK };
	const isWatched = terminal.audience === 'person' && terminal.err.isInteractive;
	const status = isWatched ? await followRun(request) : await waitForRun(request);

	await printResult(terminal, status, statusView(new Date()));

	return signal.aborted ? EXIT.cancelled : EXIT.ok;
}
