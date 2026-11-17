import { afterEach, expect, test } from 'bun:test';

import { request } from '../../src/lib/api/http';

const realFetch = globalThis.fetch;

/** The paths the stubbed `fetch` was asked for. */
let fetched: string[] = [];

/** Puts the reads the early fetch script would have started on `window`, and stubs `fetch` to answer `fresh`. */
function startEarly(reads: Record<string, { at: number; response: Promise<Response> }>): void {
	Object.assign(globalThis, { window: { __recoderEarly: reads } });
	fetched = [];

	globalThis.fetch = Object.assign(
		(url: string | URL | Request) => {
			fetched.push(new URL(String(url)).pathname);

			return Promise.resolve(Response.json('fresh'));
		},
		{ preconnect: realFetch.preconnect }
	);
}

afterEach(() => {
	globalThis.fetch = realFetch;
	Reflect.deleteProperty(globalThis, 'window');
});

test('an early read stands in for the first plain read of its path, and the next read asks the server', async () => {
	startEarly({ '/api/repos': { at: Date.now(), response: Promise.resolve(Response.json('early')) } });

	expect(await request<string>('/api/repos')).toBe('early');
	expect(await request<string>('/api/repos')).toBe('fresh');
	expect(fetched).toEqual(['/api/repos']);
});

test('an early read from more than ten seconds ago is ignored', async () => {
	startEarly({ '/api/repos': { at: Date.now() - 11_000, response: Promise.resolve(Response.json('early')) } });

	expect(await request<string>('/api/repos')).toBe('fresh');
});

test('a write never takes the early read of its path', async () => {
	startEarly({ '/api/repos': { at: Date.now(), response: Promise.resolve(Response.json('early')) } });

	expect(await request<string>('/api/repos', { method: 'POST', body: '{}' })).toBe('fresh');
});
