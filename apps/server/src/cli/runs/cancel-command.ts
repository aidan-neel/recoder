import { EXIT, type ExitCode } from '../exit.js';
import { cancelRun } from './cancel-run.js';
import { writeJsonLine } from './json-line.js';
import type { RunId } from './run-id.js';

/** `recoder cancel <run-id>`: SIGTERM is what a review already treats as cancel, cleaning up before it exits. */
export async function runCancelCommand(runId: RunId): Promise<ExitCode> {
	await writeJsonLine(await cancelRun(runId, (pid) => process.kill(pid, 'SIGTERM')));

	return EXIT.ok;
}
