import { afterEach, expect, test } from 'bun:test';
import { serveMcp } from '../../../src/cli/mcp/mcp-server';
import { liveIdentity, runIdAt, storeRun, useFreshDataDir } from '../runs/run-fixtures';
import {
	connect,
	createInput,
	parseLine,
	repliesIn,
	testEnvironment,
	toolCall,
	toolResultOf,
	TestProcesses,
	type TestClient
} from './server-harness';

const processes = new TestProcesses();

afterEach(() => processes.reset());

useFreshDataDir();

const PARSE_ERROR = -32700;

const INVALID_REQUEST = -32600;

const METHOD_NOT_FOUND = -32601;

const INVALID_PARAMS = -32602;

function client(): Promise<TestClient> {
	return connect(testEnvironment(['true'], processes));
}

function ping(id: number): object {
	return { jsonrpc: '2.0', id, method: 'ping' };
}

async function storeRunningRun(): Promise<string> {
	return (await storeRun(runIdAt(1), await liveIdentity())).runId;
}

test('a line that is not JSON gets a parse error with no id, and the server goes on', async () => {
	const server = await client();

	server.sendLine('{"jsonrpc": "2.0", "id": 1, "method": ');
	server.send(ping(2));

	expect((await server.replyTo(2)).result).toEqual({});

	const [parseError] = repliesIn(server.written);

	expect(parseError.error?.code).toBe(PARSE_ERROR);
	expect(parseError).not.toHaveProperty('id');

	server.close();
	await server.served;
});

test('an unknown method gets method not found under its id, and the server goes on', async () => {
	const server = await client();

	server.send({ jsonrpc: '2.0', id: 'a', method: 'resources/list' });
	server.send(ping(2));

	expect((await server.replyTo('a')).error?.code).toBe(METHOD_NOT_FOUND);
	expect((await server.replyTo(2)).result).toEqual({});

	server.close();
	await server.served;
});

test('a message that is not a request or a notification gets invalid request under its id', async () => {
	const server = await client();

	server.send({ jsonrpc: '2.0', id: 7, params: {} });

	expect((await server.replyTo(7)).error?.code).toBe(INVALID_REQUEST);

	server.close();
	await server.served;
});

test('a notification gets no reply', async () => {
	const server = await client();

	server.send({ jsonrpc: '2.0', method: 'notifications/initialized' });
	server.send({ jsonrpc: '2.0', method: 'notifications/unknown', params: {} });
	server.send(ping(3));
	server.close();
	await server.served;

	expect(repliesIn(server.written).map((reply) => reply.id)).toEqual([3]);
});

test('a call to an unknown tool is a protocol error', async () => {
	const server = await client();

	server.send(toolCall(1, 'recoder_rewrite', {}));

	expect((await server.replyTo(1)).error?.code).toBe(INVALID_PARAMS);

	server.close();
	await server.served;
});

test('arguments a tool refuses come back as a tool error of one line', async () => {
	const server = await client();

	server.send(toolCall(1, 'recoder_wait', { runId: 42, timeoutSeconds: 'soon', extra: true }));

	const result = toolResultOf(await server.replyTo(1));

	expect(result.isError).toBe(true);
	expect(result.text).not.toContain('\n');

	server.close();
	await server.served;
});

test('a tool that fails returns its error as one line with isError', async () => {
	const server = await client();

	server.send(toolCall(1, 'recoder_status', { runId: runIdAt(9) }));

	const result = toolResultOf(await server.replyTo(1));

	expect(result.isError).toBe(true);
	expect(result.text).toContain(runIdAt(9));
	expect(result.text).not.toContain('\n');

	server.close();
	await server.served;
});

test('a slow recoder_wait does not hold back a call sent after it', async () => {
	const runId = await storeRunningRun();
	const server = await client();

	server.send(toolCall(1, 'recoder_wait', { runId }));
	server.send(toolCall(2, 'recoder_status', { runId }));

	expect(toolResultOf(await server.replyTo(2)).isError).toBe(false);
	expect(repliesIn(server.written).map((reply) => reply.id)).toEqual([2]);

	server.close();
	await server.served;
});

test('notifications/cancelled stops a wait, which then gets no reply', async () => {
	const runId = await storeRunningRun();
	const server = await client();

	server.send(toolCall(1, 'recoder_wait', { runId }));
	server.send({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: 1, reason: 'done' } });
	server.send(ping(2));
	await server.replyTo(2);
	server.close();
	await server.served;

	expect(repliesIn(server.written).map((reply) => reply.id)).toEqual([2]);
});

test('a batch is answered with one line holding the reply of each request, and none for its notifications', async () => {
	const server = await client();

	server.sendLine(
		JSON.stringify([
			ping(1),
			{ jsonrpc: '2.0', method: 'notifications/progress', params: {} },
			7,
			toolCall(2, 'recoder_status', { runId: runIdAt(9) })
		])
	);

	server.close();
	await server.served;

	const [line, ...rest] = server.written.map(parseLine);
	const replies = Array.isArray(line) ? line : [];

	expect(rest).toEqual([]);
	expect(replies.map((reply) => reply.id ?? null).sort()).toEqual([1, 2, null]);
	expect(replies.find((reply) => reply.id === undefined)?.error?.code).toBe(INVALID_REQUEST);
});

test('a batch of notifications alone writes nothing', async () => {
	const server = await client();

	server.sendLine(JSON.stringify([{ jsonrpc: '2.0', method: 'notifications/progress', params: {} }]));
	server.send(ping(2));
	await server.replyTo(2);
	server.close();
	await server.served;

	expect(server.written.map(parseLine)).toEqual([{ jsonrpc: '2.0', id: 2, result: {} }]);
});

test('an empty batch gets one invalid request reply, not an array', async () => {
	const server = await client();

	server.sendLine('[]');
	server.close();
	await server.served;

	const [reply] = repliesIn(server.written);

	expect(server.written.map(parseLine)).toEqual([reply]);
	expect(reply.error?.code).toBe(INVALID_REQUEST);
});

test('cancelling one request of a batch leaves its reply out of the batch and keeps the others', async () => {
	const runId = await storeRunningRun();
	const server = await client();

	server.sendLine(JSON.stringify([toolCall(1, 'recoder_wait', { runId }), ping(2)]));
	server.send({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: 1 } });
	await server.replyTo(2);
	server.close();
	await server.served;

	expect(server.written.map(parseLine)).toEqual([[{ jsonrpc: '2.0', id: 2, result: {} }]]);
});

test('closing the input stops a waiting call, answers it with the status it has, and ends the server', async () => {
	const runId = await storeRunningRun();
	const server = await client();

	server.send(toolCall(1, 'recoder_wait', { runId }));
	server.close();
	await server.served;

	const [reply] = repliesIn(server.written);

	expect(JSON.parse(toolResultOf(reply).text)).toMatchObject({ runId, state: 'running' });
});

test('a reply that cannot be written stops the calls and ends the server, though the input stays open', async () => {
	const runId = await storeRunningRun();
	const input = createInput();
	const brokenPipe = new Error('write EPIPE');

	const writeLine = async (): Promise<void> => {
		throw brokenPipe;
	};

	const served = serveMcp({ lines: input.lines, writeLine }, testEnvironment(['true'], processes));

	input.push(JSON.stringify(toolCall(1, 'recoder_wait', { runId })));
	input.push(JSON.stringify(ping(2)));

	await expect(served).rejects.toBe(brokenPipe);
});

const LARGE_LINE_CHARS = 128 * 1024;

const LARGE_LINES = 300;

const BYTES_PER_MEBIBYTE = 1024 * 1024;

/** The lines sent hold about 37 MiB between them; a server that lets them go stays far under this. */
const KEPT_HEAP_LIMIT_MIB = 12;

function collectedHeapBytes(): number {
	Bun.gc(true);

	return process.memoryUsage().heapUsed;
}

test('lines the server has handled are not kept while the session lives', async () => {
	const server = await client();
	const heapBefore = collectedHeapBytes();

	for (let sent = 0; sent < LARGE_LINES; sent++) {
		const payload = `${sent}`.padEnd(LARGE_LINE_CHARS, 'x');

		server.send({ jsonrpc: '2.0', method: 'notifications/progress', params: { payload } });
		server.send(ping(sent));
		await server.replyTo(sent);
	}

	server.written.splice(0);

	const keptMebibytes = (collectedHeapBytes() - heapBefore) / BYTES_PER_MEBIBYTE;

	expect(keptMebibytes).toBeLessThan(KEPT_HEAP_LIMIT_MIB);

	server.close();
	await server.served;
});
