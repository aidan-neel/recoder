import { CliError, EXIT } from '../exit.js';

let stderrGuarded = false;

/**
 * Writes to standard output and resolves once the text has been handed to the reader, so the exit code is decided
 * after a large report is out. A reader that has gone away (`recoder review | head -1`) fails with `EXIT.failed`
 * instead of raising an unhandled error.
 */
export function writeStdout(text: string): Promise<void> {
	return new Promise((resolve, reject) => {
		const fail = (error: Error): void =>
			reject(new CliError(`cannot write to standard output: ${error.message}`, EXIT.failed));

		process.stdout.once('error', fail);

		process.stdout.write(text, (error) => {
			if (error) return fail(error);

			process.stdout.off('error', fail);
			resolve();
		});
	});
}

/**
 * Writes one line to standard error. Standard error is only for messages and progress, so a closed one is ignored:
 * there is nowhere left to say so, and it must not stop the review or change its exit code.
 */
export function writeStderrLine(line: string): void {
	guardStderr();
	process.stderr.write(`${line}\n`);
}

function guardStderr(): void {
	if (stderrGuarded) return;

	stderrGuarded = true;
	process.stderr.on('error', () => {});
}
