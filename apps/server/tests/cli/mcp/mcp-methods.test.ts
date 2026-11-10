import { afterEach, expect, test } from 'bun:test';
import { z } from 'zod';
import { VERSION } from '../../../src/version';
import { useFreshDataDir } from '../runs/run-fixtures';
import {
	connect,
	connectUninitialized,
	initializeRequest,
	repliesIn,
	testEnvironment,
	TestProcesses,
	type TestClient
} from './server-harness';

const processes = new TestProcesses();

afterEach(() => processes.reset());

useFreshDataDir();

const INVALID_REQUEST = -32600;

const INVALID_PARAMS = -32602;

const TOOLS_LIST = { jsonrpc: '2.0', id: 'tools', method: 'tools/list' };

function clientBeforeHandshake(): TestClient {
	return connectUninitialized(testEnvironment(['true'], processes));
}

function initialize(id: number, protocolVersion: string): object {
	return { jsonrpc: '2.0', id, method: 'initialize', params: { protocolVersion, capabilities: {} } };
}

test("initialize answers with the client's protocol version when the server speaks it", async () => {
	const server = clientBeforeHandshake();

	server.send(initialize(1, '2025-06-18'));

	expect((await server.replyTo(1)).result).toEqual({
		protocolVersion: '2025-06-18',
		capabilities: { tools: {} },
		serverInfo: { name: 'recoder', version: VERSION }
	});

	server.close();
	await server.served;
});

test("initialize answers with a version of the server's own when the client's is unknown", async () => {
	const server = clientBeforeHandshake();

	server.send(initialize(1, '1999-01-01'));

	const { protocolVersion } = z.object({ protocolVersion: z.string() }).parse((await server.replyTo(1)).result);

	expect(protocolVersion).toMatch(/^\d{4}-\d{2}-\d{2}$/);
	expect(protocolVersion).not.toBe('1999-01-01');

	server.close();
	await server.served;
});

test('before initialize, a request is refused as invalid while ping is answered', async () => {
	const server = clientBeforeHandshake();

	server.send(TOOLS_LIST);
	server.send({ jsonrpc: '2.0', id: 2, method: 'ping' });

	expect((await server.replyTo('tools')).error?.code).toBe(INVALID_REQUEST);
	expect((await server.replyTo(2)).result).toEqual({});

	server.close();
	await server.served;
});

test('a request sent right behind initialize, before its reply is read, runs', async () => {
	const server = clientBeforeHandshake();

	server.send(initializeRequest(1));
	server.send(TOOLS_LIST);

	expect((await server.replyTo('tools')).result).toHaveProperty('tools');

	server.close();
	await server.served;
});

test('an initialize the server refuses leaves it uninitialized', async () => {
	const server = clientBeforeHandshake();

	server.send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
	server.send(TOOLS_LIST);

	expect((await server.replyTo(1)).error?.code).toBe(INVALID_PARAMS);
	expect((await server.replyTo('tools')).error?.code).toBe(INVALID_REQUEST);

	server.close();
	await server.served;
});

test('notifications before initialize get no reply and do not initialize the server', async () => {
	const server = clientBeforeHandshake();

	server.send({ jsonrpc: '2.0', method: 'notifications/initialized' });
	server.send(TOOLS_LIST);
	await server.replyTo('tools');
	server.close();
	await server.served;

	expect(repliesIn(server.written).map((reply) => reply.error?.code)).toEqual([INVALID_REQUEST]);
});

test('a second initialize is refused as invalid', async () => {
	const server = await connect(testEnvironment(['true'], processes));

	server.send(initializeRequest(2));

	expect((await server.replyTo(2)).error?.code).toBe(INVALID_REQUEST);

	server.close();
	await server.served;
});
