import { LlmError } from '../../models/llm/errors';
import { CLI_OUTPUT_CAP_BYTES, streamCli } from '../cli-stream';
import type { SessionTail, PiReply } from './pi-session';
import { exitError, piError, type PiUsage } from './pi-output';
import { piEnv } from './pi-process';

type Env = Record<string, string | undefined>;

/** Where Pi runs: the binary, the server's environment, the processes `stop` kills, and the working directory. */
export interface PiHost {
	path: string;
	env: Env;
	running: Set<Bun.Subprocess>;
	cwd: string;
}

/** One print-mode call: its flags, its prompt, the session it writes, and what stops it. */
export interface PiCall {
	args: readonly string[];
	stdin: string;
	session: SessionTail;
	signal: AbortSignal;
	/** Each piece of the answer as Pi prints it. */
	onText?: (text: string) => void;
}

/** How a call ended: the answer, the error that stopped it, and the usage of each model call it made. */
export interface PiOutcome {
	text: string;
	error?: LlmError;
	usages: PiUsage[];
}

/**
 * Runs Pi once and reads what it saved. The answer is the last model call in the session file; Pi's stdout, which
 * prints only that answer, streams to `onText`. Throws only when the process could not run to its end (an abort,
 * the deadline, runaway output), after reporting the model calls it saved, or when its session file could not be
 * read; every other failure is the outcome's `error`.
 */
export async function runPiCall(host: PiHost, call: PiCall): Promise<PiOutcome> {
	call.session.follow();

	const exit = await streamCli({
		argv: [host.path, ...call.args],
		cwd: host.cwd,
		env: piEnv(host.env),
		stdin: call.stdin,
		signal: call.signal,
		maxOutputBytes: CLI_OUTPUT_CAP_BYTES,
		onOutput: (piece) => call.onText?.(piece),
		running: host.running,
		name: 'Pi'
	}).catch(async (error: unknown) => {
		await endTailAfterFailure(call.session);

		throw error;
	});

	const { reply, usages } = await call.session.finish();
	const error = replyError(reply) ?? (exit.code === 0 ? undefined : exitError(exit));

	if (error) return { text: '', error, usages };
	if (!reply) return { text: '', error: new LlmError(0, 'Pi ended without saving a reply.'), usages };

	return { text: reply.text, usages };
}

/**
 * Ends the session tail of a process that could not run to its end. That failure (an abort, the deadline, runaway
 * output) is the one the caller reports, so a session read that failed too must not take its place.
 */
async function endTailAfterFailure(session: SessionTail): Promise<void> {
	await Promise.allSettled([session.finish()]);
}

/** The error a saved reply ended with: Pi's own message, or its cut at the output limit; none for an answer. */
function replyError(reply: PiReply | null): LlmError | undefined {
	if (reply?.stopReason === 'error' || reply?.stopReason === 'aborted') {
		return piError(reply.errorMessage ?? `Pi's model call ended with ${reply.stopReason}.`);
	}

	if (reply?.stopReason === 'length') return new LlmError(0, "Pi's reply was truncated at the model's output limit.");

	return undefined;
}
