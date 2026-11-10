import { EXIT, type ExitCode } from '../exit.js';
import { writeJsonLine } from './json-line.js';
import type { RunId } from './run-id.js';
import { readRunStatus } from './run-status.js';

/** `recoder status <run-id>`. */
export async function runStatusCommand(runId: RunId): Promise<ExitCode> {
	await writeJsonLine(await readRunStatus(runId));

	return EXIT.ok;
}
