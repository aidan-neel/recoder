import type { Subprocess } from 'bun';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import { serveMcp } from '../../../src/cli/mcp/mcp-server';
import type { ToolEnvironment } from '../../../src/cli/mcp/tool';
import type { WaitClock } from '../../../src/cli/runs/wait-for-run';
import { childEnvironment, testDataDir } from '../child-env';

/** A client's side of an in-memory server: what it sends, and the lines the server wrote back. */
export interface TestClient {
	send: (message: object) => void;
	sendLine: (line: string) => void;
	close: () => void;
	/** Resolves with the reply that carries `id`, alone or in a batch's line, once the server has written it. */
	replyTo: (id: string | number) => Promise<Reply>;
	/** Every line the server wrote, in order; after `connect`, those that follow the handshake. */
	written: string[];
	/** Settles when the server has ended. */
	served: Promise<void>;
}

const replySchema = z.looseObject({
	jsonrpc: z.literal('2.0'),
	id: z.union([z.string(), z.number()]).optional(),
	result: z.unknown().optional(),
	error: z.object({ code: z.number(), message: z.string() }).optional()
});

export type Reply = z.infer<typeof replySchema>;

const toolResultSchema = z.object({
	content: z.array(z.object({ type: z.literal('text'), text: z.string() })).length(1),
	isError: z.boolean()
});

const HANDSHAKE_ID = 'handshake';

/** Starts a server and completes MCP's handshake, so the client may call anything and `written` starts empty. */
export async function connect(environment: ToolEnvironment): Promise<TestClient> {
	const client = connectUninitialized(environment);

	client.send(initializeRequest(HANDSHAKE_ID));
	await client.replyTo(HANDSHAKE_ID);
	client.written.splice(0);
	client.send({ jsonrpc: '2.0', method: 'notifications/initialized' });

	return client;
}

/** Starts a server on in-memory lines, before the handshake. */
export function connectUninitialized(environment: ToolEnvironment): TestClient {
	const input = createInput();
	const output = createOutput();

	return {
		send: (message) => input.push(JSON.stringify(message)),
		sendLine: input.push,
		close: input.close,
		replyTo: output.replyTo,
		written: output.lines,
		served: serveMcp({ lines: input.lines, writeLine: output.write }, environment)
	};
}

/** Writes a one-line patch into the test's data folder and returns its path, for a `diff` argument. */
export function writeTestPatch(): string {
	const path = join(testDataDir(), 'change.patch');

	writeFileSync(path, ['--- a/a.ts', '+++ b/a.ts', '@@ -1 +1 @@', '-old', '+new', ''].join('\n'));

	return path;
}

export function initializeRequest(id: string | number): object {
	return { jsonrpc: '2.0', id, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {} } };
}

/** A `tools/call` request. */
export function toolCall(id: number, name: string, args: object): object {
	return { jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } };
}

/** The one text item and the error flag of a `tools/call` reply. */
export function toolResultOf(reply: Reply): { text: string; isError: boolean } {
	const { content, isError } = toolResultSchema.parse(reply.result);

	return { text: content[0].text, isError };
}

/** Every reply the server wrote, parsed, a batch's replies in its place; a line that is not JSON-RPC fails. */
export function repliesIn(written: readonly string[]): Reply[] {
	return written.flatMap(parseLine);
}

/** One line the server wrote: one reply, or a batch's array of them. */
export function parseLine(line: string): Reply | Reply[] {
	return z.union([replySchema, z.array(replySchema).min(1)]).parse(JSON.parse(line));
}

export function parseReply(line: string): Reply {
	return replySchema.parse(JSON.parse(line));
}

/** Calls one tool on a server whose reviews start nothing, and returns its result. */
export async function callTool(name: string, args: object, processes: TestProcesses) {
	const server = await connect(testEnvironment(['true'], processes));

	server.send(toolCall(1, name, args));

	const result = toolResultOf(await server.replyTo(1));

	server.close();
	await server.served;

	return result;
}

/** A clock whose waits never end on their own: a wait returns only when its call is stopped. */
const STOPPED_ONLY_CLOCK: WaitClock = {
	now: () => 0,
	sleep: (_ms, signal) =>
		new Promise((resolve) => {
			signal.addEventListener('abort', () => resolve(), { once: true });
		})
};

/** A process a review start spawned, and the argv it was given. */
interface Spawned {
	argv: string[];
	child: Subprocess;
}

/** What a test's server did to processes: the ones its review starts spawned, and the stops it sent. */
export class TestProcesses {
	readonly spawned: Spawned[] = [];

	readonly stopped: number[] = [];

	private readonly listeners = new Set<() => void>();

	record(spawned: Spawned): void {
		this.spawned.push(spawned);

		for (const listener of this.listeners) listener();
	}

	/** Resolves once `count` processes have been spawned. */
	untilSpawned(count: number): Promise<Spawned[]> {
		return new Promise((resolve) => {
			const check = (): void => {
				if (this.spawned.length < count) return;

				this.listeners.delete(check);
				resolve(this.spawned.slice(0, count));
			};

			this.listeners.add(check);
			check();
		});
	}

	/**
	 * Stops and reaps every process spawned, so none outlives the test, and forgets the stops recorded. Bun runs
	 * `afterEach` hooks in the order they are registered, so register this one before `useFreshDataDir`: a child
	 * still starting after its data folder is removed would create its home folder there again.
	 */
	async reset(): Promise<void> {
		this.stopped.splice(0);

		for (const { child } of this.spawned.splice(0)) {
			if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');

			await child.exited;
		}
	}
}

/**
 * An environment whose reviews run `command` in their own session, as `--detach` starts them, with only the
 * variables `childEnvironment` allows. Stops are recorded, never sent.
 */
export function testEnvironment(command: readonly string[], processes: TestProcesses): ToolEnvironment {
	return {
		workingDirectory: tmpdir(),
		clock: STOPPED_ONLY_CLOCK,
		reviewCommand: command,
		spawn: (argv, log) => {
			const child = Bun.spawn(argv, {
				stdio: ['ignore', 'ignore', log],
				detached: true,
				env: childEnvironment(testDataDir())
			});

			processes.record({ argv, child });

			return child;
		},
		stopProcess: (pid) => {
			processes.stopped.push(pid);
		}
	};
}

/** Lines a test sends, as the async iterable the server reads. */
export function createInput() {
	const queued: string[] = [];
	let isClosed = false;
	let wake = (): void => {};

	async function* read(): AsyncGenerator<string> {
		for (;;) {
			const line = queued.shift();

			if (line !== undefined) yield line;
			else if (isClosed) return;
			else await new Promise<void>((resolve) => (wake = resolve));
		}
	}

	return {
		lines: read(),
		push: (line: string) => {
			queued.push(line);
			wake();
		},
		close: () => {
			isClosed = true;
			wake();
		}
	};
}

/** The server's lines, and a way to wait for one reply among them. */
function createOutput() {
	const lines: string[] = [];
	const listeners = new Set<() => void>();

	const findReply = (id: string | number): Reply | undefined => repliesIn(lines).find((reply) => reply.id === id);

	return {
		lines,
		write: async (line: string) => {
			lines.push(line);

			for (const listener of listeners) listener();
		},
		replyTo: (id: string | number) =>
			new Promise<Reply>((resolve) => {
				const check = (): void => {
					const reply = findReply(id);

					if (reply === undefined) return;

					listeners.delete(check);
					resolve(reply);
				};

				listeners.add(check);
				check();
			})
	};
}
