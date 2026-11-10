import { writeStdout } from '../output/streams.js';

/** Writes a value as one line of JSON on standard output, the form every run command prints. */
export async function writeJsonLine(value: unknown): Promise<void> {
	await writeStdout(`${JSON.stringify(value)}\n`);
}
