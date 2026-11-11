import type { Surface } from '../terminal/surface.js';
import type { Terminal } from '../terminal/terminal.js';
import { writeStdout } from './streams.js';

/** A command's result laid out for a person, as the lines to print. */
export type ResultView<Value> = (value: Value, surface: Surface) => string[];

/**
 * Prints a command's result on standard output: one line of JSON for a program, whose fields are the contract, or
 * the view for a person.
 */
export async function printResult<Value>(terminal: Terminal, value: Value, view: ResultView<Value>): Promise<void> {
	if (terminal.audience === 'program') {
		await writeStdout(`${JSON.stringify(value)}\n`);

		return;
	}

	await writeStdout(`${view(value, terminal.out).join('\n')}\n`);
}
