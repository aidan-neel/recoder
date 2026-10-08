import { AsyncLocalStorage } from 'node:async_hooks';
import { randomBytes } from 'node:crypto';
import { NATIVE_TOOLS } from '../../evidence/native-tools';
import type { SessionScope } from './opencode-session';

/** The agent a tool slot currently serves: it runs the call and returns the text the model reads. */
export type ToolRunner = (name: string, args: unknown) => Promise<{ text: string; isError: boolean }>;

/** A leased slot: the prefix OpenCode puts before its tool names, and how to give it back. */
export interface ToolLease {
	prefix: string;
	release(): void;
}

/**
 * One registered MCP server in OpenCode. A tool call carries no session, so
 * the slot it arrives on is what names the agent: each running agent holds a
 * slot of its own, and a finished agent's slot serves the next one.
 */
interface Slot {
	name: string;
	token: string;
	runner: ToolRunner | null;
}

const NO_METHOD = -32601;

interface RpcMessage {
	id?: unknown;
	method?: unknown;
	params?: { name?: unknown; arguments?: unknown; protocolVersion?: unknown };
}

function result(id: unknown, value: unknown): Response {
	return Response.json({ jsonrpc: '2.0', id, result: value });
}

function toolText(text: string, isError: boolean): { content: { type: 'text'; text: string }[]; isError: boolean } {
	return { content: [{ type: 'text', text }], isError };
}

/** Answers one MCP request for a slot. Notifications have no id and get no body. */
async function answer(slot: Slot, message: RpcMessage): Promise<Response> {
	const { id, method, params } = message;

	if (id === undefined) return new Response(null, { status: 202 });

	if (method === 'initialize') {
		return result(id, {
			protocolVersion: params?.protocolVersion ?? '2025-03-26',
			capabilities: { tools: {} },
			serverInfo: { name: 'recoder', version: '1' }
		});
	}

	if (method === 'ping') return result(id, {});

	if (method === 'tools/list') {
		return result(id, {
			tools: NATIVE_TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema }))
		});
	}

	if (method === 'tools/call') {
		if (!slot.runner) return result(id, toolText('This review agent has finished; the tool is closed.', true));

		const outcome = await slot.runner(String(params?.name ?? ''), params?.arguments).catch((error: unknown) => ({
			text: error instanceof Error ? error.message : 'The tool failed.',
			isError: true
		}));

		return result(id, toolText(outcome.text, outcome.isError));
	}

	return Response.json({ jsonrpc: '2.0', id, error: { code: NO_METHOD, message: 'Method not found' } });
}

/**
 * Serves Recoder's evidence tools to OpenCode over MCP, on loopback behind a
 * random path per slot. OpenCode's own shell and file tools stay off: the
 * model reads and runs code only through these, so everything it does goes
 * through the review sandbox and never through the process holding the user's
 * provider logins.
 */
export class OpenCodeToolHost {
	private server: ReturnType<typeof Bun.serve> | null = null;
	private readonly slots: Slot[] = [];

	private listen(): ReturnType<typeof Bun.serve> {
		this.server ??= Bun.serve({
			port: 0,
			hostname: '127.0.0.1',
			idleTimeout: 0,
			fetch: async (request) => {
				const token = new URL(request.url).pathname.replace(/^\/mcp\//, '');
				const slot = this.slots.find((item) => item.token === token);

				if (!slot) return new Response('not found', { status: 404 });
				if (request.method !== 'POST') return new Response(null, { status: 405 });

				const message = (await request.json().catch(() => null)) as RpcMessage | null;

				if (!message || typeof message !== 'object') return new Response('bad request', { status: 400 });

				return answer(slot, message);
			}
		});

		this.server.unref();

		return this.server;
	}

	/**
	 * Gives `runner` a slot and makes sure OpenCode has it registered. It is
	 * registered again on every lease: OpenCode forgets added servers when it
	 * restarts or reloads its providers, and adding one it already has is cheap.
	 * Calls run in the leasing agent's async context, not the server's, so a tool
	 * that calls a model (a delegated worker) is billed to the agent's review and
	 * runs on its review's locked models.
	 */
	async lease(scope: SessionScope, runner: ToolRunner, signal: AbortSignal): Promise<ToolLease> {
		const { port } = this.listen();
		let slot = this.slots.find((item) => !item.runner);

		if (!slot) {
			slot = { name: `recoder${this.slots.length + 1}`, token: randomBytes(24).toString('base64url'), runner: null };
			this.slots.push(slot);
		}

		const leased = slot;
		const inAgentContext = AsyncLocalStorage.snapshot();
		const bound: ToolRunner = (name, args) => inAgentContext(() => runner(name, args));

		leased.runner = bound;

		const release = () => {
			if (leased.runner === bound) leased.runner = null;
		};

		try {
			const api = await scope.server.api();

			await api.addMcp(scope.directory, leased.name, `http://127.0.0.1:${port}/mcp/${leased.token}`, signal);
		} catch (error) {
			release();

			throw error;
		}

		return { prefix: leased.name, release };
	}

	stop(): void {
		void this.server?.stop(true);
		this.server = null;
	}
}

export const toolHost = new OpenCodeToolHost();
