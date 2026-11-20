import { afterAll, expect, test } from 'bun:test';
import { getServerIdentity } from '../../src/eval/client';
import { restoreEnvAfterEach } from '../helpers/env';

let status = 500;
let calls = 0;
let authorization: string | null = null;

restoreEnvAfterEach(['RECODER_API_TOKEN']);

const server = Bun.serve({
	port: 0,
	fetch(request) {
		calls += 1;
		authorization = request.headers.get('authorization');

		return new Response(status === 404 ? 'Not Found' : 'identity failed', { status });
	}
});

const base = `http://localhost:${server.port}`;

afterAll(() => {
	void server.stop(true);
});

test('a server that fails /health/identity fails the capture after one retry, naming the status', async () => {
	status = 500;
	calls = 0;

	await expect(getServerIdentity(base)).rejects.toThrow('GET /health/identity: HTTP 500 identity failed');
	expect(calls).toBe(2);
});

test('only a server without the route, which answers 404, has no identity', async () => {
	status = 404;
	calls = 0;

	expect(await getServerIdentity(base)).toBeNull();
	expect(calls).toBe(1);
});

test('the benchmark authenticates its server identity read with the machine token', async () => {
	process.env.RECODER_API_TOKEN = 'test-token-'.padEnd(40, 'x');
	status = 404;

	await getServerIdentity(base);

	expect(authorization).toBe(`Bearer ${process.env.RECODER_API_TOKEN}`);
});
