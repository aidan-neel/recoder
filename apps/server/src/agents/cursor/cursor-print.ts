import { CLI_OUTPUT_CAP_BYTES, LineSplitter, streamCli, type CliExit } from '../cli-stream';
import { CursorReader, type CursorHandlers } from './cursor-output';

/** Print mode with structured output and real-time text deltas; the prompt goes in on stdin. */
export const PRINT_ARGS = ['-p', '--output-format', 'stream-json', '--stream-partial-output'];

/**
 * How long a call's process group is given to exit on its own once the `result` event arrives: current CLI
 * versions can print the terminal result and keep a worker alive, so the group is killed after this grace.
 */
const RESULT_SETTLE_MS = 250;

/** One print-mode call: the CLI and its arguments, where it runs, what it reads, and where its output goes. */
export interface PrintCall {
	argv: readonly string[];
	cwd: string;
	env: Record<string, string>;
	stdin: string;
	/** The caller's deadline; aborting it kills the process group. */
	signal: AbortSignal;
	/** The processes in flight, so the adapter's `stop` can kill them at exit. */
	running: Set<Bun.Subprocess>;
	/** The CLI's name, for error messages. */
	name: string;
	/** What the parsed events do. */
	handlers: CursorHandlers;
}

/** How a print-mode call ended: the reader always, and either the process's exit or what stopped it early. */
export type PrintOutcome =
	{ ok: true; reader: CursorReader; exit: CliExit } | { ok: false; reader: CursorReader; error: unknown };

/**
 * Runs one `cursor-agent -p` call and reads its `stream-json` events line by line. The `result` event arms a
 * short settle before the process group is killed, since the CLI can print the result and keep a worker alive;
 * a call stopped after its `result` still reports that exit as clean. A call that fails before its `result`
 * comes back `ok: false` with the stream error — the caller words it, so aborts and timeouts keep their meaning.
 */
export async function streamPrintCall(call: PrintCall): Promise<PrintOutcome> {
	const finished = new AbortController();
	let settleTimer: ReturnType<typeof setTimeout> | null = null;

	const reader = new CursorReader({
		...call.handlers,
		result: () => {
			settleTimer = setTimeout(() => finished.abort(), RESULT_SETTLE_MS);
			settleTimer.unref();
			call.handlers.result?.();
		}
	});

	const lines = new LineSplitter(reader.line);

	try {
		const exit = await streamCli({
			argv: call.argv,
			cwd: call.cwd,
			env: call.env,
			stdin: call.stdin,
			signal: AbortSignal.any([call.signal, finished.signal]),
			maxOutputBytes: CLI_OUTPUT_CAP_BYTES,
			onOutput: lines.push,
			running: call.running,
			name: call.name
		});

		lines.end();

		return { ok: true, reader, exit };
	} catch (error) {
		lines.end();

		if (reader.finished) return { ok: true, reader, exit: { code: 0, stderr: '' } };

		return { ok: false, reader, error };
	} finally {
		if (settleTimer) clearTimeout(settleTimer);
	}
}
