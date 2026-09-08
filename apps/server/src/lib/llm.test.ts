import { afterEach, describe, expect, test } from 'bun:test';
import { chatCompletion, resetLlmLimiter } from './llm';

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
});
