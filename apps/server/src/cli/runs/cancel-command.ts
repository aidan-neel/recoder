import { EXIT, type ExitCode } from '../exit.js';
import { printResult } from '../output/print-result.js';
import type { Terminal } from '../terminal/terminal.js';
import { cancelRun } from './cancel-run.js';
import { resolveRunReference, type RunReference } from './run-reference.js';
import { cancelView } from './run-view.js';

/** `recoder cancel [run]`: SIGTERM is what a review already treats as cancel, cleaning up before it exits. */
export async function runCancelCommand(run: RunReference, terminal: Terminal): Promise<ExitCode> {
	const runId = await resolveRunReference(run);
	const status = await cancelRun(runId, (pid) => process.kill(pid, 'SIGTERM'));

	await printResult(terminal, status, cancelView(new Date()));

	return EXIT.ok;
}
