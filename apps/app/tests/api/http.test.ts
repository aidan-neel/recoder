import { afterEach, describe, expect, jest, spyOn, test } from 'bun:test';

import {
	del,
	failureKind,
	failureText,
	isOffline,
	NetworkError,
	OFFLINE_TEXT,
	post,
	postStream,
	put,
	request,
	StreamError,
	TimeoutError
} from '../../src/lib/api/http';
import { flush } from '../fixtures';

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
	jest.useRealTimers();
	globalThis.fetch = realFetch;
});

describe('failure messages', () => {
	test('an error frame in a stream shows the server’s words', () => {
		expect(failureText(new StreamError('Pick a reviewer model in Settings → Agent first.'), 'fallback')).toBe(
			'Pick a reviewer model in Settings → Agent first.'
		);
	});

	test('a fetch that never reaches the server reads as offline', async () => {
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

	test('an answer the page cannot parse shows a fixed sentence and logs a warning, not an error', async () => {
		const warned = spyOn(console, 'warn').mockImplementation(() => {});
		const logged = spyOn(console, 'error').mockImplementation(() => {});
		const unreadable = await failure(() => Promise.resolve(new Response('{"id":', { status: 200 })));

		expect(failureText(unreadable)).toBe('The server’s answer wasn’t readable.');
		expect(warned).toHaveBeenCalledTimes(1);
		expect(logged).not.toHaveBeenCalled();

		warned.mockRestore();
		logged.mockRestore();
	});

	test('a bug’s own message never reaches the page, which shows the fallback while the bug logs an error', () => {
		const logged = spyOn(console, 'error').mockImplementation(() => {});

		expect(failureText(new TypeError('Cannot read properties of undefined (reading ’id’)'), 'Couldn’t save.')).toBe(
			'Couldn’t save.'
		);

		expect(logged).toHaveBeenCalledTimes(1);
		logged.mockRestore();
	});

	test('a forge refusal the server passes through raw reads as a sign-in failure in plain words', async () => {
		const rejected = await failure(() =>
			Promise.resolve(
				Response.json(
					{
						error:
							'gh not authenticated: [stderr]\nHTTP 401: Bad credentials (https://api.github.com/graphql)\nTry authenticating with:  gh auth login',
						kind: 'auth'
					},
					{ status: 502 }
				)
			)
		);

		expect(failureKind(rejected)).toBe('auth');
		expect(failureText(rejected)).toBe('GitHub rejected the token. Update it in Settings → Connections.');
	});
});

describe('reads', () => {
	/** Answers every request with `body` after the test lets it go, counting the calls. */
	function held(body: unknown) {
		const calls: string[] = [];
		let release = () => {};
		const gate = new Promise<void>((resolve) => (release = resolve));

		globalThis.fetch = (async (input: string, init?: RequestInit) => {
			calls.push(`${init?.method ?? 'GET'} ${new URL(input).pathname}`);
			await gate;

			return Response.json(body);
		}) as unknown as typeof fetch;

		return { calls, release };
	}

	test('identical reads made at once share one request, and each caller gets its own copy', async () => {
		const server = held([{ id: 'rv-1' }]);
		const first = request<{ id: string }[]>('/api/reviews');
		const second = request<{ id: string }[]>('/api/reviews');

		server.release();

		const [a, b] = await Promise.all([first, second]);

		expect(server.calls).toEqual(['GET /api/reviews']);
		expect(a).toEqual(b);
		expect(a).not.toBe(b);
	});

	test('a read asked in a later task sends its own request, even while an identical one is in flight', async () => {
		const server = held({ id: 'rv-1' });
		const first = request('/api/reviews/rv-1');

		await new Promise((resolve) => setTimeout(resolve, 5));

		const later = request('/api/reviews/rv-1');

		server.release();
		await Promise.all([first, later]);

		expect(server.calls).toEqual(['GET /api/reviews/rv-1', 'GET /api/reviews/rv-1']);
	});

	test('a read made after a write never joins a read made before it', async () => {
		const server = held([]);
		const before = request('/api/reviews');
		const write = post('/api/reviews', { repoId: 'r1', prNumber: 1 });
		const after = request('/api/reviews');

		server.release();
		await Promise.all([before, write, after]);

		expect(server.calls).toEqual(['GET /api/reviews', 'POST /api/reviews', 'GET /api/reviews']);
	});

	test('a read the server does not answer in time fails as a timeout, not as offline', async () => {
		globalThis.fetch = ((_input: string, init?: RequestInit) =>
			new Promise((_resolve, reject) => {
				init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
			})) as unknown as typeof fetch;

		const error = await request('/api/repos/r1/pulls', { timeoutMs: 10 }).catch((caught: unknown) => caught);

		expect(error).toBeInstanceOf(TimeoutError);
		expect(isOffline(error)).toBe(false);
		expect(failureKind(error)).toBe('timeout');
	});

	test('a forge that rejected the token reads as a sign-in failure, other server errors keep their message', async () => {
		const rejected = await failure(() =>
			Promise.resolve(Response.json({ error: 'Bad credentials', kind: 'auth' }, { status: 502 }))
		);

		const broken = await failure(() => Promise.resolve(Response.json({ error: 'disk full' }, { status: 500 })));

		expect(failureKind(rejected)).toBe('auth');
		expect(failureKind(broken)).toBe('server');
		expect(failureText(broken)).toBe('Disk full.');
	});
});

describe('writes', () => {
	test('a write given no time limit still gets one, so a stalled save fails instead of hanging', async () => {
		const signals: (AbortSignal | null | undefined)[] = [];

		globalThis.fetch = (async (_input: string, init?: RequestInit) => {
			signals.push(init?.signal);

			return Response.json({});
		}) as unknown as typeof fetch;

		await post('/api/reviews/rv-1/dismissals', { findingId: 'f1' });
		await put('/api/settings/models', {});
		await del('/api/reviews/rv-1/dismissals/f1');

		expect(signals).toHaveLength(3);

		for (const signal of signals) {
			expect(signal).toBeInstanceOf(AbortSignal);
			expect(signal?.aborted).toBe(false);
		}
	});
});

describe('streams', () => {
	/** Answers with an event stream the test feeds one frame at a time; the stream errors when the request is aborted. */
	function stalling() {
		let push = (_frame: string) => {};

		globalThis.fetch = ((_input: string, init?: RequestInit) => {
			const body = new ReadableStream<Uint8Array>({
				start(controller) {
					push = (frame) => controller.enqueue(new TextEncoder().encode(frame));
					init?.signal?.addEventListener('abort', () => controller.error(init.signal?.reason));
				}
			});

			return Promise.resolve(new Response(body, { headers: { 'Content-Type': 'text/event-stream' } }));
		}) as unknown as typeof fetch;

		return { push: (frame: string) => push(frame) };
	}

	test('a stream fails as a timeout only once it has gone quiet, however long it has run', async () => {
		jest.useFakeTimers();

		const server = stalling();
		const tokens: unknown[] = [];
		let outcome: unknown = 'pending';

		postStream('/api/guidelines/draft', {}, (event) => tokens.push(event)).then(
			() => (outcome = 'done'),
			(error: unknown) => (outcome = error)
		);

		await flush();
		jest.advanceTimersByTime(200_000);
		server.push('data: {"type":"token","text":"Hi"}\n\n');
		await flush();
		jest.advanceTimersByTime(200_000);
		await flush();

		expect(outcome).toBe('pending');

		jest.advanceTimersByTime(200_000);
		await flush();

		expect(tokens).toEqual([{ type: 'token', text: 'Hi' }]);
		expect(outcome).toBeInstanceOf(TimeoutError);
	});
});
