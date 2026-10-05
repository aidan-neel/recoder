import { afterEach, expect, test } from 'bun:test';
import { OpenCodeToolHost, type ToolRunner } from '../../../src/agents/opencode/opencode-mcp';
import type { SessionScope } from '../../../src/agents/opencode/opencode-session';

const host = new OpenCodeToolHost();

afterEach(() => host.stop());

/** A stand-in OpenCode that records the servers it is told to add, and refuses them when `refuse` is set. */
function scope(added: { name: string; url: string }[], refuse = false): SessionScope {
	const addMcp = async (_directory: string, name: string, url: string) => {
		added.push({ name, url });

		if (refuse) throw new Error('refused');
	};

	return { server: { api: async () => ({ addMcp }) } as unknown as SessionScope['server'], directory: '/tmp/empty' };
}

function call(url: string, name: string): Promise<Response> {
	return fetch(url, {
		method: 'POST',
		body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: {} } })
	});
}

const signal = new AbortController().signal;

const runner =
	(label: string): ToolRunner =>
	async (name) => ({ text: `${label}:${name}`, isError: false });

async function text(response: Response): Promise<string> {
	return ((await response.json()) as { result: { content: { text: string }[] } }).result.content[0].text;
}

test('a tool call reaches the agent that holds the slot it arrives on', async () => {
	const added: { name: string; url: string }[] = [];

	await host.lease(scope(added), runner('first'), signal);
	await host.lease(scope(added), runner('second'), signal);

	expect(added.map((item) => item.name)).toEqual(['recoder1', 'recoder2']);
	expect(await text(await call(added[0].url, 'search'))).toBe('first:search');
	expect(await text(await call(added[1].url, 'search'))).toBe('second:search');
});

test('a released slot refuses calls until the next agent leases it', async () => {
	const added: { name: string; url: string }[] = [];
	const lease = await host.lease(scope(added), runner('first'), signal);

	lease.release();

	expect(await text(await call(added[0].url, 'search'))).toContain('finished');

	await host.lease(scope(added), runner('next'), signal);

	expect(added[1]).toEqual(added[0]);
	expect(await text(await call(added[0].url, 'search'))).toBe('next:search');
});

test('a path without a slot token is not served', async () => {
	const added: { name: string; url: string }[] = [];

	await host.lease(scope(added), runner('first'), signal);

	const response = await call(added[0].url.replace(/[^/]+$/, 'guess'), 'search');

	expect(response.status).toBe(404);
});

test('a slot OpenCode could not connect to is not leased', async () => {
	const added: { name: string; url: string }[] = [];

	await expect(host.lease(scope(added, true), runner('first'), signal)).rejects.toThrow('refused');
	await host.lease(scope(added), runner('second'), signal);

	expect(added[1].name).toBe(added[0].name);
});
