import { CliError, EXIT } from '../exit.js';

let stderrGuarded = false;

/** What takes each line written to standard error while a view is redrawing there; null lets lines straight through. */
let stderrClaimant: ((line: string) => void) | null = null;

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
	if (stderrClaimant !== null) return stderrClaimant(line);

	guardedStderr().write(`${line}\n`);
}

/** Standard error, for a view that draws on it; a closed one is ignored as `writeStderrLine` ignores it. */
export function guardedStderr(): NodeJS.WriteStream {
	guardStderr();

	return process.stderr;
}

/**
 * Hands every line `writeStderrLine` gets to `write` until the returned function is called. A view that redraws a
 * block on standard error claims it, so a message is printed above the block and not into it.
 */
export function claimStderr(write: (line: string) => void): () => void {
	stderrClaimant = write;

	return () => {
		if (stderrClaimant === write) stderrClaimant = null;
	};
}

function guardStderr(): void {
	if (stderrGuarded) return;

	stderrGuarded = true;
	process.stderr.on('error', () => {});
}
