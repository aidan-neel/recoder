import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash, randomBytes } from 'node:crypto';
import { NATIVE_TOOLS } from '../../evidence/native-tools';
import type { AgentEvent, ToolOutcome, ToolRunner } from '../contract';

/** A leased slot: the server name the CLI knows it by, the URL it calls, and how to give it back. */
export interface ToolLease {
	name: string;
	url: string;
	release(): void;
}

/** A shared OpenCode catalog lease, bound to exactly one session before it can call tools. */
export interface SessionToolLease extends ToolLease {
	bindSession(id: string): void;
}

/**
 * A tool a lease lists by its own definition, rather than by a native tool name.
 * Adapters still pass names; {@link withMcpToolCatalog} supplies definitions for those names during `openRun`.
 */
export interface McpToolDefinition {
	name: string;
	description: string;
	inputSchema: Record<string, unknown>;
}

/** Definitions bound for the `openRun` that is leasing, so a name lease can list something other than the native tools. */
const toolCatalog = new AsyncLocalStorage<readonly McpToolDefinition[]>();

/**
 * Runs `run` with `definitions` as the tools a name lease lists, when every requested name is in the catalog.
 * A review lease names tools the catalog does not have (`run`, `delegate`), so it still lists the native tools.
 * Bind this around `openRun` only: a review started while a prompt runs must not inherit the catalog.
 */
export function withMcpToolCatalog<T>(definitions: readonly McpToolDefinition[], run: () => T): T {
	return toolCatalog.run(definitions, run);
}

/** The run a slot serves now: the tools it may call, the definitions it lists, and where its events go. */
interface Tenant {
	tools: ReadonlySet<string>;
	definitions: readonly McpToolDefinition[];
	runner: ToolRunner;
	onEvent: (event: AgentEvent) => void;
}

/**
 * One MCP server path for one run at a time. A tool call carries no session, so the slot it arrives on names the
 * run, and a finished run's slot serves the next one under a new token, so a process of the finished run that
 * still holds the old URL never reaches the next run's tools.
 */
interface Slot {
	name: string;
	token: string;
	tenant: Tenant | null;
}

/**
 * One MCP server path that many OpenCode sessions share. Its name and tool list depend only on the tool
 * definitions, so every session given the same tools sees the same tool prefix and the provider can reuse the
 * cached prompt across them. A call names its run by the session ID OpenCode sends with it.
 */
interface Catalog {
	owner: object;
	key: string;
	name: string;
	token: string;
	definitions: readonly McpToolDefinition[];
	sessions: Map<string, Tenant>;
}

/** What one MCP path offers and which run a `tools/call` on it belongs to. */
interface Endpoint {
	offered: readonly McpToolDefinition[];
	tenantFor(params: RpcMessage['params']): Tenant | null;
}

/** The `_meta` key OpenCode puts its session ID under on every MCP tool call. */
const OPENCODE_SESSION_META = 'ai.opencode/sessionID';

interface RpcMessage {
	id?: unknown;
	method?: unknown;
	params?: { name?: unknown; arguments?: unknown; protocolVersion?: unknown; _meta?: Record<string, unknown> };
}

const NO_METHOD = -32601;

/** Hex digits of the definitions digest in a catalog's name; OpenAI caps a tool name at 64 characters. */
const CATALOG_NAME_HEX = 24;

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
	private readonly catalogs: Catalog[] = [];

	/**
	 * Gives a run a slot for `tools`: native tool names, or definitions the run carries itself. Calls run in the
	 * leasing run's async context, not the server's, so a tool that calls a model (a delegated worker) is billed
	 * to the run's review and runs on its locked models. A name list uses the catalog from {@link withMcpToolCatalog}
	 * only when that catalog defines every name; otherwise it lists the native tools, which is what a review lease does.
	 */
	lease(
		tools: readonly string[] | readonly McpToolDefinition[],
		runner: ToolRunner,
		onEvent: (event: AgentEvent) => void
	): ToolLease {
		const { port } = this.listen();
		const leased = this.freeSlot();
		const definitions = listedDefinitions(tools);

		const tenant = createTenant(tools, definitions, runner, onEvent);

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

	/**
	 * OpenCode filters tool definitions by permission. A catalog keeps a stable name and URL while concurrent
	 * runs bind separate session IDs; releasing one never changes the list or exposes the next run to its ID.
	 * Each OpenCode server owns its routing namespace; the content digest in the name is independent of that owner.
	 */
	leaseSession(
		tools: readonly string[] | readonly McpToolDefinition[],
		runner: ToolRunner,
		onEvent: (event: AgentEvent) => void,
		owner: object = this
	): SessionToolLease {
		const { port } = this.listen();

		const definitions = listedDefinitions(tools)
			.map((tool) => canonicalDefinition(tool))
			.sort((a, b) => byCodePoint(a.name, b.name));

		const catalog = this.catalogFor(owner, definitions);
		const tenant = createTenant(tools, definitions, runner, onEvent);
		let session: string | undefined;
		let released = false;

		return {
			name: catalog.name,
			url: `http://127.0.0.1:${port}/mcp/${catalog.token}`,
			bindSession: (id) => {
				if (released || session !== undefined || !id || catalog.sessions.has(id))
					throw new Error(`This OpenCode tool lease cannot bind session "${id}".`);

				session = id;
				catalog.sessions.set(id, tenant);
			},
			release: () => {
				released = true;
				if (session !== undefined) catalog.sessions.delete(session);
			}
		};
	}

	stop(): void {
		void this.server?.stop(true);
		this.server = null;
	}

	/** The catalog `owner` serves `definitions` from, created on first use. */
	private catalogFor(owner: object, definitions: readonly McpToolDefinition[]): Catalog {
		const key = createHash('sha256').update(JSON.stringify(definitions)).digest('hex');
		const existing = this.catalogs.find((item) => item.owner === owner && item.key === key);

		if (existing) return existing;

		const catalog = {
			owner,
			key,
			name: `recoder_${key.slice(0, CATALOG_NAME_HEX)}`,
			token: newToken(),
			definitions,
			sessions: new Map<string, Tenant>()
		};

		this.catalogs.push(catalog);

		return catalog;
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
		const endpoint = this.endpoint(token);

		if (!endpoint) return new Response('not found', { status: 404 });
		if (request.method !== 'POST') return new Response(null, { status: 405 });

		const message = await readMessage(request);

		if (!message) return new Response('bad request', { status: 400 });

		return answer(endpoint, message);
	}

	private endpoint(token: string): Endpoint | null {
		const slot = this.slots.find((item) => item.token === token);

		if (slot) return { offered: slot.tenant?.definitions ?? [], tenantFor: () => slot.tenant };

		const catalog = this.catalogs.find((item) => item.token === token);

		if (!catalog) return null;

		return { offered: catalog.definitions, tenantFor: (params) => catalogTenant(catalog, params) };
	}
}

/** The run a shared catalog's call belongs to: the one bound to the session ID OpenCode sent, if any. */
function catalogTenant(catalog: Catalog, params: RpcMessage['params']): Tenant | null {
	const session = params?._meta?.[OPENCODE_SESSION_META];

	if (typeof session !== 'string') return null;

	return catalog.sessions.get(session) ?? null;
}

/** Capture each run's billing and model context even when the HTTP listener belongs to another run. */
function createTenant(
	tools: readonly string[] | readonly McpToolDefinition[],
	definitions: readonly McpToolDefinition[],
	runner: ToolRunner,
	onEvent: (event: AgentEvent) => void
): Tenant {
	const inRunContext = AsyncLocalStorage.snapshot();

	return {
		tools: new Set(requestedNames(tools)),
		definitions,
		runner: (name, args) => inRunContext(() => runner(name, args)),
		onEvent
	};
}

/** The names a lease permits, whether it was given names or definitions. */
function requestedNames(tools: readonly string[] | readonly McpToolDefinition[]): string[] {
	return tools.flatMap((tool) => (typeof tool === 'string' ? [tool] : [tool.name]));
}

/**
 * What `tools/list` returns. Definitions passed in are listed as given. Names list the catalog when it covers
 * every name, and the native tools otherwise, in native order, so a review lease is unchanged.
 */
function listedDefinitions(tools: readonly string[] | readonly McpToolDefinition[]): McpToolDefinition[] {
	const first = tools[0];

	if (first !== undefined && typeof first === 'object') {
		return tools.flatMap((tool) => (typeof tool === 'object' ? [copyDefinition(tool)] : []));
	}

	return definitionsForNames(tools.flatMap((tool) => (typeof tool === 'string' ? [tool] : [])));
}

function definitionsForNames(names: readonly string[]): McpToolDefinition[] {
	const active = toolCatalog.getStore();

	if (active && names.every((name) => active.some((tool) => tool.name === name))) {
		return names.flatMap((name) => {
			const found = active.find((tool) => tool.name === name);

			return found ? [copyDefinition(found)] : [];
		});
	}

	return NATIVE_TOOLS.filter((tool) => names.includes(tool.name)).map(copyDefinition);
}

/** Object key order must not change a catalog's identity or serialized schemas. */
function canonicalValue(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(canonicalValue);
	if (value && typeof value === 'object') return canonicalObject(value);

	return value;
}

function canonicalObject(value: object): Record<string, unknown> {
	return Object.fromEntries(
		Object.entries(value)
			.sort(([a], [b]) => byCodePoint(a, b))
			.map(([key, item]) => [key, canonicalValue(item)])
	);
}

/** A locale-free order, so a catalog's digest is the same on every machine. */
function byCodePoint(a: string, b: string): number {
	if (a === b) return 0;

	return a < b ? -1 : 1;
}

function canonicalDefinition(tool: McpToolDefinition): McpToolDefinition {
	return { ...copyDefinition(tool), inputSchema: canonicalObject(tool.inputSchema) };
}

function copyDefinition(tool: McpToolDefinition): McpToolDefinition {
	return { name: tool.name, description: tool.description, inputSchema: tool.inputSchema };
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

/** Answers one MCP request for an endpoint. Notifications have no id and get no body. */
async function answer(endpoint: Endpoint, message: RpcMessage): Promise<Response> {
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
			tools: endpoint.offered.map(({ name, description, inputSchema }) => ({ name, description, inputSchema }))
		});
	}

	if (method === 'tools/call') {
		return result(
			id,
			toolText(await callTool(endpoint.tenantFor(params), String(params?.name ?? ''), params?.arguments))
		);
	}

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
