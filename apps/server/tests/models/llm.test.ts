import { afterEach, describe, expect, test } from 'bun:test';
import { chatCompletion, reasoningFields, resetLlmLimiter, streamChatCompletion } from '../../src/models/llm';

describe('llm concurrency limiter', () => {
	const realFetch = globalThis.fetch;

	afterEach(() => {
		globalThis.fetch = realFetch;
		resetLlmLimiter();
		delete process.env.RECODER_LLM_CONCURRENCY;
	});

	test('caps concurrent model calls', async () => {
		process.env.RECODER_REVIEW_BASE_URL = 'http://localhost:9/v1';
		process.env.RECODER_REVIEW_API_KEY = 'test';
		process.env.RECODER_LLM_CONCURRENCY = '2';

		let active = 0;
		let peak = 0;

		globalThis.fetch = (async () => {
			active++;
			peak = Math.max(peak, active);
			await new Promise((r) => setTimeout(r, 20));
			active--;

			return new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), {
				status: 200,
				headers: { 'content-type': 'application/json' }
			});
		}) as unknown as typeof fetch;

		const call = () =>
			chatCompletion({
				baseUrl: 'http://localhost:9/v1',
				apiKey: 'test',
				model: 'test-model',
				messages: [{ role: 'user', content: 'hi' }]
			});

		const results = await Promise.all([call(), call(), call(), call(), call()]);

		expect(results).toEqual(['ok', 'ok', 'ok', 'ok', 'ok']);
		expect(peak).toBeLessThanOrEqual(2);
	});

	test('review reasoning streams before the JSON result, preserving request options and usage', async () => {
		let controller!: ReadableStreamDefaultController<Uint8Array>;
		let request: Record<string, unknown> = {};

		globalThis.fetch = (async (_url: RequestInfo | URL, init?: RequestInit) => {
			request = JSON.parse(String(init?.body));

			return new Response(
				new ReadableStream<Uint8Array>({
					start(stream) {
						controller = stream;
					}
				}),
				{
					headers: { 'content-type': 'text/event-stream' }
				}
			);
		}) as unknown as typeof fetch;

		const send = (value: unknown) =>
			controller.enqueue(
				new TextEncoder().encode(`data: ${typeof value === 'string' ? value : JSON.stringify(value)}\n\n`)
			);

		const reasoning: string[] = [];
		const states: string[] = [];
		const usage: unknown[] = [];
		let sawReasoning!: () => void;

		const firstReasoning = new Promise<void>((resolve) => {
			sawReasoning = resolve;
		});

		let finished = false;

		const result = chatCompletion({
			baseUrl: 'http://model.test',
			apiKey: 'test',
			model: 'test',
			messages: [],
			jsonMode: true,
			reasoningEffort: 'high',
			seed: 7,
			onReasoning: (text) => {
				reasoning.push(text);
				sawReasoning();
			},
			onProgress: (state) => states.push(state),
			onUsage: (value) => usage.push(value)
		}).then((value) => {
			finished = true;

			return value;
		});

		while (!controller) await Promise.resolve();
		send({ choices: [{ delta: { reasoning_content: 'Checking the changed path.' } }] });
		await firstReasoning;
		expect(finished).toBe(false);

		expect(request).toMatchObject({
			stream: true,
			response_format: { type: 'json_object' },
			reasoning_effort: 'high',
			seed: 7
		});

		send({ choices: [{ delta: { reasoning: ' Comparing the caller.' } }] });
		send({ choices: [{ delta: { content: '{"ok":true}' }, finish_reason: 'stop' }] });
		send({ choices: [], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } });
		send('[DONE]');
		expect(await result).toBe('{"ok":true}');
		expect(reasoning.join('')).toBe('Checking the changed path. Comparing the caller.');
		expect(states).toEqual(['queued', 'running']);
		expect(usage).toHaveLength(1);
		expect(usage[0]).toMatchObject({ totalTokens: 15 });
	});

	test('cancelling a reasoning stream releases its reader and model slot', async () => {
		process.env.RECODER_LLM_CONCURRENCY = '1';

		let started!: () => void;

		const ready = new Promise<void>((resolve) => {
			started = resolve;
		});

		let cancelled = false;

		globalThis.fetch = (async () =>
			new Response(
				new ReadableStream({
					start() {
						started();
					},
					cancel() {
						cancelled = true;
					}
				})
			)) as unknown as typeof fetch;

		const controller = new AbortController();

		const options = {
			baseUrl: 'http://model.test',
			apiKey: 'test',
			model: 'test',
			messages: [],
			onReasoning: () => {}
		};

		const result = chatCompletion({ ...options, signal: controller.signal });

		await ready;

		/** One macrotask, so the response hands its reader to the stream parser before the cancel. */
		const readerHandedOff = new Promise((resolve) => setTimeout(resolve, 0));

		await readerHandedOff;
		controller.abort();
		await expect(result).rejects.toThrow('cancelled');
		expect(cancelled).toBe(true);

		globalThis.fetch = (async () =>
			Response.json({ choices: [{ message: { content: 'ok' } }] })) as unknown as typeof fetch;

		expect(await chatCompletion(options)).toBe('ok');
	});
});

describe('hung model calls', () => {
	const realFetch = globalThis.fetch;

	afterEach(() => {
		globalThis.fetch = realFetch;
		resetLlmLimiter();
		delete process.env.RECODER_LLM_CONCURRENCY;
	});

	test('a request stuck below the abort (a half-dead socket) still times out and frees its slot', async () => {
		process.env.RECODER_LLM_CONCURRENCY = '1';
		globalThis.fetch = (() => new Promise(() => {})) as unknown as typeof fetch;

		const call = (stream: boolean) => {
			const opts = {
				baseUrl: 'http://model.test/v1',
				apiKey: 'k',
				model: 'm',
				messages: [{ role: 'user' as const, content: 'hi' }],
				timeoutMs: 50
			};

			return stream ? streamChatCompletion(opts, () => {}) : chatCompletion(opts);
		};

		await expect(call(true)).rejects.toThrow(/timed out/);
		await expect(call(false)).rejects.toThrow(/timed out/);

		globalThis.fetch = (async () =>
			Response.json({ choices: [{ message: { content: 'ok' } }] })) as unknown as typeof fetch;

		expect(await call(false)).toBe('ok');
	});

	test('cancelling a hung request ends it at once', async () => {
		globalThis.fetch = (() => new Promise(() => {})) as unknown as typeof fetch;

		const controller = new AbortController();

		const pending = streamChatCompletion(
			{
				baseUrl: 'http://model.test/v1',
				apiKey: 'k',
				model: 'm',
				messages: [{ role: 'user', content: 'hi' }],
				timeoutMs: 60_000,
				signal: controller.signal
			},
			() => {}
		);

		setTimeout(() => controller.abort(), 20);
		await expect(pending).rejects.toThrow(/cancelled/);
	});

	test('a response that lands after the deadline reports no usage', async () => {
		globalThis.fetch = (() =>
			new Promise((resolve) =>
				setTimeout(
					() =>
						resolve(
							Response.json({
								choices: [{ message: { content: 'late' } }],
								usage: { prompt_tokens: 10, completion_tokens: 5 }
							})
						),
					400
				)
			)) as unknown as typeof fetch;

		let usage = 0;

		const pending = chatCompletion({
			baseUrl: 'http://model.test/v1',
			apiKey: 'k',
			model: 'm',
			messages: [{ role: 'user', content: 'hi' }],
			timeoutMs: 50,
			onUsage: () => usage++
		});

		await expect(pending).rejects.toThrow(/timed out/);
		await new Promise((resolve) => setTimeout(resolve, 500));
		expect(usage).toBe(0);
	});
});

test('OpenRouter gets effort as a reasoning object, other endpoints as reasoning_effort', () => {
	expect(reasoningFields({ baseUrl: 'https://openrouter.ai/api/v1', reasoningEffort: 'high' })).toEqual({
		reasoning: { effort: 'high' }
	});

	expect(reasoningFields({ baseUrl: 'http://localhost:8000/v1', reasoningEffort: 'low' })).toEqual({
		reasoning_effort: 'low'
	});

	expect(reasoningFields({ baseUrl: 'https://openrouter.ai/api/v1' })).toEqual({});
});
