import { EXIT, type ExitCode } from '../exit.js';
import { printResult } from '../output/print-result.js';
import type { Terminal } from '../terminal/terminal.js';
import { resolveRunReference, type RunReference } from './run-reference.js';
import { readRunStatus } from './run-status.js';
import { statusView } from './run-view.js';

/** `recoder status [run]`. */
export async function runStatusCommand(run: RunReference, terminal: Terminal): Promise<ExitCode> {
	const status = await readRunStatus(await resolveRunReference(run));

	await printResult(terminal, status, statusView(new Date()));

	return EXIT.ok;
}
