import { z } from 'zod';
import { describeError } from '../exit.js';
import {
	RPC_ERROR,
	errorResponse,
	readLine,
	type IncomingMessage,
	type RequestId,
	type RpcNotification,
	type RpcRequest,
	type RpcResponse
} from './json-rpc.js';
import { McpMethods } from './mcp-methods.js';
import { PendingStarts } from './pending-starts.js';
import type { ToolEnvironment } from './tool.js';

/** The stdio transport as the server sees it; tests pass lines and a writer held in memory. */
export interface McpTransport {
	/** Messages from the client, one per line, without the line end. Ends when the client closes its side. */
	lines: AsyncIterable<string>;
	/** Writes one line and resolves once it is out. */
	writeLine: (line: string) => Promise<void>;
}

/** The abort reason of a call the client cancelled: it stops, and MCP says it gets no reply. */
const CANCELLED_BY_CLIENT = Symbol('cancelled by the client');

/** What `McpSession.broken` resolves with once a reply could not be written. */
const WRITE_FAILED = Symbol('a reply could not be written');

const cancelParamsSchema = z.object({ requestId: z.union([z.string(), z.int()]) });

/**
 * Serves MCP until the input ends or a reply cannot be written. Each line is one JSON-RPC message or a batch; calls
 * run at once, side by side, and each reply carries its request's id. At the end, calls still running are stopped (a wait returns
 * the status it has) and their replies are written, also when reading the input fails; then this resolves, or rejects
 * with the write or the read that failed.
 */
export async function serveMcp(transport: McpTransport, environment: ToolEnvironment): Promise<void> {
	const session = new McpSession(transport.writeLine, environment);

	try {
		await readUntilEndOrBroken(transport.lines, session);
	} finally {
		await session.end();
	}
}

/**
 * Hands each line to the session until the input ends or a write fails. A failed write ends the wait at once: a client
 * that stopped reading may keep the input open. The whole read is raced once, not each line: a race per line would
 * leave one reaction per line on `broken`, which holds every line read for as long as the session lives.
 */
async function readUntilEndOrBroken(lines: AsyncIterable<string>, session: McpSession): Promise<void> {
	await Promise.race([receiveLines(lines, session), session.broken]);
}

/** After a failed write this read is left pending; the session takes no line once it has ended. */
async function receiveLines(lines: AsyncIterable<string>, session: McpSession): Promise<void> {
	for await (const line of lines) session.receive(line);
}

/** One client's session: the calls in flight, the replies still to come, and the one writer they go through, in turn. */
class McpSession {
	private readonly calls = new Map<RequestId, AbortController>();

	/** One per line whose reply is not queued yet; each leaves once its reply is queued, or once it has none. */
	private readonly replies = new Set<Promise<void>>();

	private readonly methods = new McpMethods();

	private written: Promise<void> = Promise.resolve();

	private writeFailure: { error: unknown } | null = null;

	private readonly starts = new PendingStarts();

	private readonly brokenWrite = Promise.withResolvers<typeof WRITE_FAILED>();

	private hasEnded = false;

	constructor(
		private readonly writeLine: (line: string) => Promise<void>,
		private readonly environment: ToolEnvironment
	) {}

	/** Resolves once a reply could not be written; it never resolves while writes succeed. */
	get broken(): Promise<typeof WRITE_FAILED> {
		return this.brokenWrite.promise;
	}

	/**
	 * Handles one line. Each message starts at once, in the order the line holds them, and this returns before any call
	 * ends, so a later line can cancel it. A line that arrives after the session ended is dropped.
	 */
	receive(line: string): void {
		if (this.hasEnded || line.trim() === '') return;

		const incoming = readLine(line);

		const replied =
			incoming.kind === 'single' ? this.replyToOne(incoming.message) : this.replyToBatch(incoming.messages);

		this.replies.add(replied);
		void replied.then(() => this.replies.delete(replied));
	}

	/** Stops the calls still running, waits for their replies to be written, and fails if a write failed. */
	async end(): Promise<void> {
		this.hasEnded = true;

		for (const controller of this.calls.values()) controller.abort();

		await Promise.all(this.replies);
		await this.written;

		if (this.writeFailure !== null) throw this.writeFailure.error;
	}

	private async replyToOne(message: IncomingMessage): Promise<void> {
		const reply = await this.handle(message);

		if (reply !== null) this.send(reply);
	}

	/**
	 * Answers a batch as JSON-RPC 2.0 asks: one array of the replies, written once the last is ready. Notifications and
	 * cancelled calls have none, and a batch left with no reply writes nothing.
	 */
	private async replyToBatch(messages: readonly IncomingMessage[]): Promise<void> {
		const replies = await Promise.all(messages.map((message) => this.handle(message)));
		const written = replies.filter((reply) => reply !== null);

		if (written.length > 0) this.send(written);
	}

	/** Starts one message and resolves with its reply, or null when it gets none. Never rejects. */
	private async handle(message: IncomingMessage): Promise<RpcResponse | null> {
		if (message.kind === 'invalid') return message.reply;

		if (message.kind === 'notification') {
			this.notice(message.notification);

			return null;
		}

		return this.call(message.request);
	}

	/** A call that throws is answered with an internal error; one the client cancelled gets no reply, as MCP says. */
	private async call(request: RpcRequest): Promise<RpcResponse | null> {
		const controller = new AbortController();
		const context = { environment: this.environment, starts: this.starts, signal: controller.signal };

		this.calls.set(request.id, controller);

		const response = await this.methods
			.answer(request, context)
			.catch((error: unknown) =>
				errorResponse(request.id, RPC_ERROR.internal, `Internal error: ${describeError(error).split('\n')[0]}`)
			);

		if (this.calls.get(request.id) === controller) this.calls.delete(request.id);

		return controller.signal.reason === CANCELLED_BY_CLIENT ? null : response;
	}

	/** Only a cancel needs handling. One that names no call in flight, or is malformed, is ignored, as MCP says. */
	private notice(notification: RpcNotification): void {
		if (notification.method !== 'notifications/cancelled') return;

		const params = cancelParamsSchema.safeParse(notification.params);

		if (params.success) this.calls.get(params.data.requestId)?.abort(CANCELLED_BY_CLIENT);
	}

	/** Queues one reply, or a batch's replies, as one line. After a failed write nothing more is written. */
	private send(reply: RpcResponse | RpcResponse[]): void {
		const line = JSON.stringify(reply);

		this.written = this.written
			.then(() => (this.writeFailure === null ? this.writeLine(line) : undefined))
			.catch((error: unknown) => {
				this.writeFailure = { error };
				this.brokenWrite.resolve(WRITE_FAILED);
			});
	}
}
