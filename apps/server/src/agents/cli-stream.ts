import { LlmError } from '../models/llm/errors';
import { killGroup, killOnAbort } from './cli-process';

/**
 * The most stdout an agent CLI may print for one prompt. A review's replies come to well under a megabyte even
 * with streamed partial messages; this only stops a CLI that runs away.
 */
export const CLI_OUTPUT_CAP_BYTES = 32 * 1024 * 1024;

/** How much of a CLI's stderr is kept for its error message: the tail, where the error is. */
const STDERR_TAIL_CHARS = 16_000;

/** One run of an agent CLI process: what to run, where, what it reads, and where its output goes. */
export interface CliInvocation {
	/** The binary and its arguments; never a shell string. */
	argv: readonly string[];
	cwd: string;
	env: Record<string, string>;
	/** Text written to the process's stdin, or null for none. */
	stdin: string | null;
	/** Aborting it kills the process group at once; it carries the caller's deadline. */
	signal: AbortSignal;
	/** The most stdout the process may print in all; past it the process is killed and the run fails. */
	maxOutputBytes: number;
	/** Each decoded piece of stdout as it arrives. */
	onOutput: (text: string) => void;
	/** The processes in flight, so the adapter's `stop` can kill them at exit. */
	running: Set<Bun.Subprocess>;
	/** The CLI's name, for error messages. */
	name: string;
}

/** How the process ended: its exit code, and the tail of what it wrote to stderr. */
export interface CliExit {
	code: number;
	stderr: string;
}

/**
 * Runs a CLI in its own process group and streams its stdout. When `signal` aborts, the group is killed and the
 * call rejects at once, without waiting on pipes that may never close; output past `maxOutputBytes` kills it too.
 * The call ends when the CLI's process does, however it ends: what it started is killed then, so nothing it left
 * holding stdout or stderr keeps the call open.
 */
export async function streamCli(invocation: CliInvocation): Promise<CliExit> {
	const proc = Bun.spawn([...invocation.argv], {
		cwd: invocation.cwd,
		env: invocation.env,
		detached: true,
		stdin: invocation.stdin === null ? 'ignore' : new Blob([invocation.stdin]),
		stdout: 'pipe',
		stderr: 'pipe'
	});

	invocation.running.add(proc);

	const { stopped, release } = killOnAbort(proc, invocation.signal);

	try {
		const [, stderr, code] = await Promise.race([
			Promise.all([readStdout(proc, invocation), stderrTail(proc.stderr), groupExit(proc)]),
			stopped
		]);

		return { code, stderr };
	} finally {
		release();
		invocation.running.delete(proc);
		killGroup(proc);
	}
}

/**
 * The CLI's exit code, once the rest of its process group is killed: a child it started inherits its stdout and
 * stderr, and would hold them open after the CLI itself has died.
 */
async function groupExit(proc: Bun.Subprocess): Promise<number> {
	const code = await proc.exited;

	killGroup(proc);

	return code;
}

/** Hands stdout to `onOutput` piece by piece, killing the process once it passes the output cap. */
async function readStdout(
	proc: Bun.Subprocess<'ignore' | Blob, 'pipe', 'pipe'>,
	invocation: CliInvocation
): Promise<void> {
	const decoder = new TextDecoder();
	let bytes = 0;

	for await (const chunk of proc.stdout) {
		bytes += chunk.byteLength;

		if (bytes > invocation.maxOutputBytes) {
			killGroup(proc);
			throw new LlmError(0, `${invocation.name} printed more than ${invocation.maxOutputBytes} bytes; it was stopped.`);
		}

		invocation.onOutput(decoder.decode(chunk, { stream: true }));
	}

	const rest = decoder.decode();

	if (rest) invocation.onOutput(rest);
}

/** The last {@link STDERR_TAIL_CHARS} characters of stderr, read to its end so the process never blocks on it. */
async function stderrTail(stream: ReadableStream<Uint8Array>): Promise<string> {
	const decoder = new TextDecoder();
	let tail = '';

	for await (const chunk of stream) tail = (tail + decoder.decode(chunk, { stream: true })).slice(-STDERR_TAIL_CHARS);

	return tail;
}

/**
 * Splits streamed text into lines and hands each non-blank one to `onLine`. `end` hands over the last line, which
 * has no newline after it.
 */
export class LineSplitter {
	private buffer = '';

	constructor(private readonly onLine: (line: string) => void) {}

	readonly push = (text: string): void => {
		this.buffer += text;

		const lines = this.buffer.split('\n');

		this.buffer = lines.pop() ?? '';
		for (const line of lines) if (line.trim()) this.onLine(line);
	};

	end(): void {
		if (this.buffer.trim()) this.onLine(this.buffer);

		this.buffer = '';
	}
}
