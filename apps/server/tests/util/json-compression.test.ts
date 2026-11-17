import { expect, test } from 'bun:test';
import { randomBytes } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { Hono } from 'hono';
import { jsonCompression } from '../../src/util/json-compression';

function fixture() {
	const app = new Hono();
	let value = 'x'.repeat(16_000);

	app.use('*', jsonCompression());

	app.get('/large', (c) => {
		c.header('ETag', '"head"');

		return c.json({ value });
	});

	app.get('/small', (c) => c.json({ ok: true }));
	app.get('/events', (c) => c.body('data: ' + value + '\n\n', 200, { 'Content-Type': 'text/event-stream' }));

	return {
		app,
		change: () => {
			value = 'y'.repeat(16_000);
		}
	};
}

test('gzip negotiation respects explicit refusals and wildcard preferences', async () => {
	const { app } = fixture();

	for (const [accept, compressed] of [
		['gzip', true],
		['br, gzip;q=0.5', true],
		['*;q=1', true],
		['gzip;q=0, *;q=1', false],
		['br', false],
		['', false]
	] as const) {
		const response = await app.request('/large', { headers: { 'Accept-Encoding': accept } });

		expect(response.headers.get('Content-Encoding')).toBe(compressed ? 'gzip' : null);
		expect(response.headers.get('Vary')).toContain('Accept-Encoding');

		const bytes = Buffer.from(await response.arrayBuffer());
		const text = compressed ? gunzipSync(bytes).toString() : bytes.toString();

		expect(JSON.parse(text)).toEqual({ value: 'x'.repeat(16_000) });
	}
});

test('a changed JSON body replaces cached and concurrent compressed responses', async () => {
	const { app, change } = fixture();
	const request = () => app.request('/large', { headers: { 'Accept-Encoding': 'gzip' } });
	const first = await Promise.all([request(), request()]);

	for (const response of first)
		expect(JSON.parse(gunzipSync(await response.arrayBuffer()).toString()).value[0]).toBe('x');
	change();

	const response = await request();

	expect(JSON.parse(gunzipSync(await response.arrayBuffer()).toString()).value[0]).toBe('y');
	expect(response.headers.get('ETag')).toBe('W/"head"');
});

test('small JSON and event streams stay uncompressed', async () => {
	const { app } = fixture();

	for (const path of ['/small', '/events']) {
		const response = await app.request(path, { headers: { 'Accept-Encoding': 'gzip' } });

		expect(response.headers.get('Content-Encoding')).toBeNull();
		expect((await response.text()).length).toBeGreaterThan(0);
	}
});

test('an incompressible body keeps its original bytes and encoding', async () => {
	const body = randomBytes(16_000);
	const app = new Hono();

	app.use('*', jsonCompression());
	app.get('/', () => new Response(new Uint8Array(body), { headers: { 'Content-Type': 'application/json' } }));

	const response = await app.request('/', { headers: { 'Accept-Encoding': 'gzip' } });

	expect(response.headers.get('Content-Encoding')).toBeNull();
	expect(Buffer.from(await response.arrayBuffer()).equals(body)).toBe(true);
});
