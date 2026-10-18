import { afterEach, describe, expect, test } from 'bun:test';

import { failureText, isOffline, NetworkError, OFFLINE_TEXT, request } from '../../src/lib/api/http';

const realFetch = globalThis.fetch;

/** The error a request rejects with while `fetch` behaves as given. */
async function failure(stub: () => Promise<Response>): Promise<unknown> {
	globalThis.fetch = stub as unknown as typeof fetch;

	return request('/api/reviews/rv-1').then(
		() => null,
		(error: unknown) => error
	);
}

afterEach(() => {
	globalThis.fetch = realFetch;
});

describe('failure messages', () => {
	test('an error frame in a stream shows the server’s words, and only a failed fetch reads as offline', async () => {
		expect(failureText(new Error('Pick a reviewer model in Settings → Agent first.'), 'fallback')).toBe(
			'Pick a reviewer model in Settings → Agent first.'
		);

		const unreachable = await failure(() => Promise.reject(new TypeError('Failed to fetch')));

		expect(unreachable).toBeInstanceOf(NetworkError);
		expect(failureText(unreachable, 'fallback')).toBe(OFFLINE_TEXT);
	});

	test('a server that answered with a body the page cannot read never reads as offline', async () => {
		const unreadable = await failure(() => Promise.resolve(new Response('{"id":', { status: 200 })));

		expect(unreadable).toBeInstanceOf(SyntaxError);
		expect(isOffline(unreadable)).toBe(false);
		expect(isOffline(new TypeError('Cannot read properties of undefined'))).toBe(false);
	});
});
