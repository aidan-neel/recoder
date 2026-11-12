import { AsyncLocalStorage } from 'node:async_hooks';
import { randomBytes } from 'node:crypto';
import { NATIVE_TOOLS } from '../../evidence/native-tools';
import type { AgentEvent, ToolOutcome, ToolRunner } from '../contract';

/** A leased slot: the server name the CLI knows it by, the URL it calls, and how to give it back. */
export interface ToolLease {
	name: string;
	url: string;
	release(): void;
}

/** The run a slot serves now: the tools it may call, the runner that answers them, and where its events go. */
interface Tenant {
	tools: ReadonlySet<string>;
	runner: ToolRunner;
	onEvent: (event: AgentEvent) => void;
}

/**
 * One MCP server path. A tool call carries no session, so the slot it arrives on is what names the run: each
 * running agent holds a slot of its own, and a finished run's slot serves the next one under a new token, so a
 * process of the finished run that still holds the old URL never reaches the next run's tools.
 */
interface Slot {
	name: string;
	token: string;
	tenant: Tenant | null;
}

interface RpcMessage {
	id?: unknown;
	method?: unknown;
	params?: { name?: unknown; arguments?: unknown; protocolVersion?: unknown };
}

const NO_METHOD = -32601;

/** The largest request body a slot reads; a tool call's arguments are a path, a query or a short command. */
const MAX_REQUEST_BYTES = 1_000_000;

function result(id: unknown, value: unknown): Response {
	return Response.json({ jsonrpc: '2.0', id, result: value });
}

function toolText({ text, isError }: ToolOutcome): { content: { type: 'text'; text: string }[]; isError: boolean } {
	return { content: [{ type: 'text', text }], isError };
}

/**
 * Serves Recoder's evidence tools to agent CLIs over MCP (streamable HTTP), on loopback behind a random path per
 * slot. This is the tool boundary every adapter shares: a CLI's own shell, file and network tools stay off, so
 * the model reads and runs code only through these. A slot lists only the tools its run may use and refuses any
 * other name before the gate sees it; each call is reported to the run as a `tool-call` and a `tool-result`
 * event.
 */
export class McpToolHost {
	private server: ReturnType<typeof Bun.serve> | null = null;
	private readonly slots: Slot[] = [];

	/**
	 * Gives a run a slot for `tools`. Calls run in the leasing run's async context, not the server's, so a tool
	 * that calls a model (a delegated worker) is billed to the run's review and runs on its locked models.
	 */
	lease(tools: readonly string[], runner: ToolRunner, onEvent: (event: AgentEvent) => void): ToolLease {
		const { port } = this.listen();
		const leased = this.freeSlot();
		const inRunContext = AsyncLocalStorage.snapshot();

		const tenant: Tenant = {
			tools: new Set(tools),
			runner: (name, args) => inRunContext(() => runner(name, args)),
			onEvent
		};

		leased.tenant = tenant;
		leased.token = newToken();

		return {
			name: leased.name,
			url: `http://127.0.0.1:${port}/mcp/${leased.token}`,
			release: () => {
				if (leased.tenant === tenant) leased.tenant = null;
			}
		};
	}

	stop(): void {
		void this.server?.stop(true);
		this.server = null;
	}

	/** A slot no run holds, or a new one when every slot is held. */
	private freeSlot(): Slot {
		const free = this.slots.find((item) => !item.tenant);

		if (free) return free;

		const slot = { name: `recoder${this.slots.length + 1}`, token: newToken(), tenant: null };

		this.slots.push(slot);

		return slot;
	}

	private listen(): ReturnType<typeof Bun.serve> {
		this.server ??= Bun.serve({
			port: 0,
			hostname: '127.0.0.1',
			idleTimeout: 0,
			fetch: (request) => this.route(request)
		});

		this.server.unref();

		return this.server;
	}

	private async route(request: Request): Promise<Response> {
		const token = new URL(request.url).pathname.replace(/^\/mcp\//, '');
		const slot = this.slots.find((item) => item.token === token);

		if (!slot) return new Response('not found', { status: 404 });
		if (request.method !== 'POST') return new Response(null, { status: 405 });

		const message = await readMessage(request);

		if (!message) return new Response('bad request', { status: 400 });

		return answer(slot, message);
	}
}

/** A random path token, so only the process given a slot's URL can reach it. */
function newToken(): string {
	return randomBytes(24).toString('base64url');
}

/** The JSON-RPC message of a request, or null when it is too large or not a JSON object. */
async function readMessage(request: Request): Promise<RpcMessage | null> {
	const body = await request.text();

	if (body.length > MAX_REQUEST_BYTES) return null;

	try {
		const message: unknown = JSON.parse(body);

		return message && typeof message === 'object' && !Array.isArray(message) ? message : null;
	} catch {
		return null;
	}
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
		const offered = NATIVE_TOOLS.filter((tool) => slot.tenant?.tools.has(tool.name));

		return result(id, {
			tools: offered.map(({ name, description, inputSchema }) => ({ name, description, inputSchema }))
		});
	}

	if (method === 'tools/call')
		return result(id, toolText(await callTool(slot.tenant, String(params?.name ?? ''), params?.arguments)));

	return Response.json({ jsonrpc: '2.0', id, error: { code: NO_METHOD, message: 'Method not found' } });
}

/** Runs a call for the slot's run, refusing a closed slot and a tool the run was not given. */
async function callTool(tenant: Tenant | null, name: string, args: unknown): Promise<ToolOutcome> {
	if (!tenant) return { text: 'This review agent has finished; the tool is closed.', isError: true };
	if (!tenant.tools.has(name)) return { text: `There is no tool named ${name}.`, isError: true };

	tenant.onEvent({ type: 'tool-call', name });

	const outcome = await tenant.runner(name, args).catch((error: unknown) => ({
		text: error instanceof Error ? error.message : 'The tool failed.',
		isError: true
	}));

	tenant.onEvent({ type: 'tool-result', name, isError: outcome.isError });

	return outcome;
}

/** The host every adapter leases from. Its server is unref'd, so it never keeps the process alive. */
export const toolHost = new McpToolHost();
