import { usageHint } from './args/command.js';
import { CliError, EXIT, describeError, type ExitCode } from './exit.js';
import { writeStderrLine } from './output/streams.js';
import { textWidth, type Surface } from './terminal/surface.js';
import type { Terminal } from './terminal/terminal.js';
import { indent, wrapText } from './terminal/text.js';

const MARGIN = 2;

/**
 * Reports a command that failed on standard error and returns its exit code. Every error ends as a message with no
 * stack: one `recoder:` line for a program, and a marked, wrapped message for a person. A usage error is followed
 * by where the command's help is.
 */
export function reportFailure(error: unknown, argv: string[], terminal: Terminal): ExitCode {
	const exitCode = error instanceof CliError ? error.exitCode : EXIT.failed;
	const hint = exitCode === EXIT.usage ? usageHint(argv) : null;

	if (terminal.audience === 'program') {
		writeStderrLine(`recoder: ${describeError(error)}`);

		if (hint !== null) writeStderrLine(hint);

		return exitCode;
	}

	for (const line of failureLines(describeError(error), { exitCode, hint }, terminal.err)) writeStderrLine(line);

	return exitCode;
}

function failureLines(
	message: string,
	failure: { exitCode: ExitCode; hint: string | null },
	surface: Surface
): string[] {
	const { paint, glyphs } = surface;
	const isStop = failure.exitCode === EXIT.cancelled;
	const mark = isStop ? paint.warning(glyphs.warn) : paint.error(glyphs.fail);
	const [first = '', ...rest] = wrapText(capitalize(message), textWidth(surface, MARGIN + glyphs.fail.length + 1));
	const hint = failure.hint === null ? [] : [paint.muted(failure.hint.replaceAll('`', ''))];

	return ['', ...indent([`${mark} ${first}`, ...indent([...rest, ...hint], glyphs.fail.length + 1)], MARGIN), ''];
}

/** A message that starts with a word starts with a capital; one that starts with a flag or a quoted value is left. */
function capitalize(message: string): string {
	return /^[a-z]/.test(message) ? `${message[0].toUpperCase()}${message.slice(1)}` : message;
}
