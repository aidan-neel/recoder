import { afterEach, expect, test } from 'bun:test';
import { AsyncLocalStorage } from 'node:async_hooks';
import { z } from 'zod';
import type { AgentEvent, ToolRunner } from '../../../src/agents/contract';
import { McpToolHost } from '../../../src/agents/tools/mcp-host';

const host = new McpToolHost();

afterEach(() => host.stop());

function rpc(url: string, method: string, params: Record<string, unknown> = {}): Promise<Response> {
	return fetch(url, { method: 'POST', body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
}

function call(url: string, name: string): Promise<Response> {
	return rpc(url, 'tools/call', { name, arguments: {} });
}

const runner =
	(label: string): ToolRunner =>
	async (name) => ({ text: `${label}:${name}`, isError: false });

const ignore = () => {};

/** A `tools/call` answer: the text the model reads and whether it is a refusal or a failure. */
const callSchema = z.object({
	result: z.object({ content: z.array(z.object({ text: z.string() })), isError: z.boolean() })
});

/** A `tools/list` answer. */
const listSchema = z.object({ result: z.object({ tools: z.array(z.object({ name: z.string() })) }) });

async function text(response: Response): Promise<string> {
	return callSchema.parse(await response.json()).result.content[0].text;
}

test('a tool call reaches the run that holds the slot it arrives on', async () => {
	const first = host.lease(['search'], runner('first'), ignore);
	const second = host.lease(['search'], runner('second'), ignore);

	expect([first.name, second.name]).toEqual(['recoder1', 'recoder2']);
	expect(await text(await call(first.url, 'search'))).toBe('first:search');
	expect(await text(await call(second.url, 'search'))).toBe('second:search');
});

test('a released slot refuses calls', async () => {
	const lease = host.lease(['search'], runner('first'), ignore);

	lease.release();

	expect(await text(await call(lease.url, 'search'))).toContain('finished');
});

test('the next run on a released slot gets a new URL, and the released one stays refused', async () => {
	const lease = host.lease(['search'], runner('first'), ignore);

	lease.release();

	const next = host.lease(['search'], runner('next'), ignore);
	const stale = await call(lease.url, 'search');

	expect(next.name).toBe(lease.name);
	expect(stale.status).toBe(404);
	expect(await text(await call(next.url, 'search'))).toBe('next:search');
});

test('a path without a slot token is not served', async () => {
	const lease = host.lease(['search'], runner('first'), ignore);

	const response = await call(lease.url.replace(/[^/]+$/, 'guess'), 'search');

	expect(response.status).toBe(404);
});

test('a slot lists only the tools its run may use and refuses any other before the runner sees it', async () => {
	const asked: string[] = [];

	const lease = host.lease(['read_file'], async (name) => ({ text: String(asked.push(name)), isError: false }), ignore);

	const listed = listSchema.parse(await (await rpc(lease.url, 'tools/list')).json());
	const refused = callSchema.parse(await (await call(lease.url, 'run')).json());

	expect(listed.result.tools.map((tool) => tool.name)).toEqual(['read_file']);
	expect(refused.result.isError).toBe(true);
	expect(asked).toEqual([]);
});

test('each tool call is reported to the run as a call and its result', async () => {
	const events: AgentEvent[] = [];
	const failing: ToolRunner = async () => ({ text: 'no such file', isError: true });
	const lease = host.lease(['read_file'], failing, (event) => events.push(event));

	await call(lease.url, 'read_file');

	expect(events).toEqual([
		{ type: 'tool-call', name: 'read_file' },
		{ type: 'tool-result', name: 'read_file', isError: true }
	]);
});

test('a tool call runs in the async context of the run that leased its slot, not the one that started the server', async () => {
	const review = new AsyncLocalStorage<string>();
	const seen: (string | undefined)[] = [];
	const reader: ToolRunner = async () => ({ text: String(seen.push(review.getStore())), isError: false });

	const first = review.run('first review', () => host.lease(['search'], reader, ignore));
	const second = review.run('second review', () => host.lease(['search'], reader, ignore));

	await call(second.url, 'search');
	await call(first.url, 'search');

	expect(seen).toEqual(['second review', 'first review']);
});
