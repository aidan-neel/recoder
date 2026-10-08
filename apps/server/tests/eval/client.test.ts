import { afterAll, expect, test } from 'bun:test';
import { getServerIdentity } from '../../src/eval/client';

let status = 500;
let calls = 0;

const server = Bun.serve({
	port: 0,
	fetch() {
		calls += 1;

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
