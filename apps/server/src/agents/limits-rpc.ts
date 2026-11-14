import { z } from 'zod';
import { LineSplitter, parseJson } from './cli-stream';
import { CLI_LIMITS_TIMEOUT_MS, LimitsError } from './limits-read';

/**
 * The most a CLI may print while Recoder waits for its usage. A usage answer and the notifications around it come
 * to a few kilobytes; this only stops a CLI that runs away.
 */
const OUTPUT_CAP_BYTES = 4 * 1024 * 1024;

/** A CLI to run as a JSON-RPC server over stdio: its argv, where it runs, its environment, and its name for errors. */
interface RpcServer {
	argv: string[];
	cwd: string;
	env: Record<string, string>;
	provider: string;
}

/** A message to the server: a request when it has an id, else a notification. */
export interface RpcMessage {
	id?: number;
	method: string;
	params?: Record<string, unknown>;
}

const replySchema = z.object({
	id: z.number(),
	result: z.unknown().optional(),
	error: z.object({ code: z.number().optional(), message: z.string().optional() }).optional()
});

/** The server's answer to one request: its result, or its error. */
export type RpcReply = Omit<z.infer<typeof replySchema>, 'id'>;

/**
 * Starts `server`, writes every message to it at once, and answers with the reply to each request, by id, once all
 * have come. Stdin stays open until then, since the CLIs this serves (`codex app-server`, `grok agent stdio`) exit
 * at the end of their input without answering what is still pending. The process is killed as soon as the replies
 * are in, after {@link CLI_LIMITS_TIMEOUT_MS}, or past {@link OUTPUT_CAP_BYTES}; a request left unanswered is a
 * {@link LimitsError}.
 */
export async function exchangeRpc(server: RpcServer, messages: readonly RpcMessage[]): Promise<Map<number, RpcReply>> {
	const pending = new Set(messages.flatMap((message) => (message.id === undefined ? [] : [message.id])));
	const replies = new Map<number, RpcReply>();

	const proc = Bun.spawn(server.argv, {
		cwd: server.cwd,
		env: server.env,
		stdin: 'pipe',
		stdout: 'pipe',
		stderr: 'ignore'
	});

	const timer = setTimeout(() => proc.kill('SIGKILL'), CLI_LIMITS_TIMEOUT_MS);

	try {
		proc.stdin.write(messages.map((message) => `${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`).join(''));
		await proc.stdin.flush();

		await readReplies(proc.stdout, server.provider, (id, reply) => {
			if (pending.delete(id)) replies.set(id, reply);

			return pending.size === 0;
		});
	} finally {
		clearTimeout(timer);
		proc.kill('SIGKILL');
	}

	if (pending.size > 0) throw new LimitsError(`${server.provider} did not report its usage.`);

	return replies;
}

/**
 * Hands each reply on stdout to `onReply` until it says it has all it waits for, or the stream ends. Lines that
 * are not replies (notifications, logs) are passed over.
 */
async function readReplies(
	stdout: ReadableStream<Uint8Array>,
	provider: string,
	onReply: (id: number, reply: RpcReply) => boolean
): Promise<void> {
	const decoder = new TextDecoder();
	let bytes = 0;
	let done = false;

	const lines = new LineSplitter((line) => {
		const parsed = replySchema.safeParse(parseJson(line));

		if (parsed.success && !done) done = onReply(parsed.data.id, parsed.data);
	});

	for await (const chunk of stdout) {
		bytes += chunk.byteLength;
		if (bytes > OUTPUT_CAP_BYTES) throw new LimitsError(`${provider} printed too much while reporting its usage.`);

		lines.push(decoder.decode(chunk, { stream: true }));
		if (done) return;
	}

	lines.end();
}
