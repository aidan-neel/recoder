import { afterEach, expect, test } from 'bun:test';
import { AsyncLocalStorage } from 'node:async_hooks';
import { McpToolHost } from '../../../src/agents/tools/mcp-host';

const hosts: McpToolHost[] = [];
const ignore = () => {};

function host(): McpToolHost {
	const instance = new McpToolHost();

	hosts.push(instance);

	return instance;
}

afterEach(() => {
	for (const instance of hosts.splice(0)) instance.stop();
});

async function rpc(url: string, method: string, params: Record<string, unknown> = {}) {
	const response = await fetch(url, {
		method: 'POST',
		body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params })
	});

	return response.json();
}

function call(url: string, session?: string, name = 'search') {
	return rpc(url, 'tools/call', {
		name,
		arguments: {},
		...(session === undefined ? {} : { _meta: { 'ai.opencode/sessionID': session } })
	});
}

test('concurrent sessions on one server call their own runner in their own async context', async () => {
	const instance = host();
	const context = new AsyncLocalStorage<string>();

	const lease = (label: string) =>
		context.run(label, () =>
			instance.leaseSession(
				['search'],
				async () => ({ text: `${label}:${context.getStore()}`, isError: false }),
				ignore
			)
		);

	const first = lease('first');
	const second = lease('second');

	first.bindSession('session-one');
	second.bindSession('session-two');

	expect(first.url).toBe(second.url);
	expect(first.name).toBe(second.name);

	const results = await Promise.all([call(first.url, 'session-one'), call(second.url, 'session-two')]);

	expect(results.map((reply) => reply.result.content[0].text)).toEqual(['first:first', 'second:second']);
});

test('missing, unknown and released session IDs cannot call a shared server or its next tenant', async () => {
	const instance = host();
	let calls = 0;
	const runner = async () => ({ text: String(++calls), isError: false });
	const first = instance.leaseSession(['search'], runner, ignore);

	first.bindSession('finished');
	first.release();

	const next = instance.leaseSession(['search'], runner, ignore);

	next.bindSession('next');

	for (const id of [undefined, 'unknown', 'finished']) expect((await call(first.url, id)).result.isError).toBe(true);

	expect(calls).toBe(0);
	expect((await call(next.url, 'next')).result.isError).toBe(false);
});

test('a bound session cannot call a tool outside its tenant or use a different catalog endpoint', async () => {
	const instance = host();
	let calls = 0;
	const runner = async () => ({ text: String(++calls), isError: false });
	const search = instance.leaseSession(['search'], runner, ignore);
	const run = instance.leaseSession(['run'], runner, ignore);

	search.bindSession('searcher');
	run.bindSession('runner');

	expect((await call(search.url, 'searcher', 'run')).result.isError).toBe(true);
	expect((await call(run.url, 'searcher', 'run')).result.isError).toBe(true);
	expect(calls).toBe(0);
});

test('same-role sessions list byte-identical definitions across concurrent leases and fresh hosts', async () => {
	const instance = host();
	const runner = async () => ({ text: 'ok', isError: false });
	const first = instance.leaseSession(['search', 'read_file'], runner, ignore);
	const second = instance.leaseSession(['read_file', 'search'], runner, ignore);

	first.bindSession('one');
	second.bindSession('two');

	const before = JSON.stringify(await rpc(first.url, 'tools/list'));
	const unrelated = instance.leaseSession(['run'], runner, ignore);
	const fresh = host().leaseSession(['search', 'read_file'], runner, ignore);

	first.release();
	unrelated.release();

	expect(JSON.stringify(await rpc(second.url, 'tools/list'))).toBe(before);
	expect(JSON.stringify(await rpc(fresh.url, 'tools/list'))).toBe(before);
	expect(fresh.name).toBe(second.name);
});

test('a released lease cannot bind another session', () => {
	const instance = host();
	const runner = async () => ({ text: 'ok', isError: false });
	const first = instance.leaseSession(['search'], runner, ignore);

	first.bindSession('retired');
	first.release();

	expect(() => first.bindSession('new')).toThrow();
});

test('separate OpenCode servers have isolated routing even when they use the same session ID', async () => {
	const instance = host();
	const first = instance.leaseSession(['search'], async () => ({ text: 'one', isError: false }), ignore, {});
	const second = instance.leaseSession(['search'], async () => ({ text: 'two', isError: false }), ignore, {});

	first.bindSession('same-id');
	second.bindSession('same-id');

	expect(first.name).toBe(second.name);
	expect(first.url).not.toBe(second.url);
	expect((await call(first.url, 'same-id')).result.content[0].text).toBe('one');
	expect((await call(second.url, 'same-id')).result.content[0].text).toBe('two');
});
