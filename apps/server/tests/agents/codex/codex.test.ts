import { afterEach, expect, test } from 'bun:test';
import { codex } from '../../../src/agents/codex/codex';
import { LlmError, chatCompletion, streamChatCompletion } from '../../../src/models/llm';
import { db, reviewMetrics } from '../../../src/store';
import { getReviewMetrics, withReviewMetrics } from '../../../src/models/metrics';
import { configForRole } from '../../../src/models/models';
import {
	initReviewSettings,
	saveReviewSettings,
	setReviewOverrides
} from '../../../src/review/session/review-settings';
import { testReview } from '../../helpers/review';
import { cleanupFixtures, completeEvent, finalItem, fixture, input, sse, usage } from './chatgpt-fixture';

afterEach(cleanupFixtures);

test('existing codex model routing persists without an API key or endpoint', () => {
	saveReviewSettings({
		models: [{ id: 'sub', label: 'ChatGPT', model: 'test-model', provider: 'codex', apiKey: 'must-not-be-saved' }],
		sharedModelId: 'sub'
	});

	setReviewOverrides({});
	initReviewSettings();

	expect(configForRole('correctness')).toMatchObject({
		provider: 'codex',
		baseUrl: '',
		apiKey: '',
		model: 'test-model'
	});
});

test('disconnected provider fails before any model request', async () => {
	const f = fixture({ authenticated: false });

	await expect(f.provider.complete(input)).rejects.toThrow('Sign in to ChatGPT');
	expect(f.calls).toEqual([]);
});

test('account usage and model discovery use direct endpoints and hide non-listed models', async () => {
	const f = fixture();

	expect((await f.provider.status()).limits).toEqual([
		{ name: 'Codex · 300 min', usedPercent: 25, resetsAt: 1900001000 },
		{ name: 'Spark · 10080 min', usedPercent: 40, resetsAt: 1900002000 }
	]);

	expect(await f.provider.models()).toEqual([{ id: 'test-model', label: 'Test model' }]);
});

test('usage failure preserves login and reports its own error, not App Server unavailable', async () => {
	const f = fixture({
		handler: (call) => (call.url.endsWith('/wham/usage') ? new Response('', { status: 503 }) : undefined)
	});

	expect(await f.provider.status()).toMatchObject({
		available: true,
		authenticated: true,
		error: expect.stringContaining('HTTP 503')
	});

	expect(await f.provider.complete(input)).toBe('{"findings":[]}');
});

test('harness completion and streaming use direct HTTP, count once each and preserve HTTP failure status', async () => {
	let limited = false;

	const f = fixture({
		handler: (call) => {
			if (!call.url.endsWith('/responses')) return undefined;
			if (limited) return new Response('', { status: 429 });

			return sse([
				{ type: 'response.output_item.added', item: { ...finalItem, content: [] } },
				{ type: 'response.output_text.delta', item_id: 'answer', delta: '{"findings":' },
				{ type: 'response.output_text.delta', item_id: 'answer', delta: '[]}' },
				completeEvent({ usage })
			]);
		}
	});

	const original = codex.complete;

	codex.complete = f.provider.complete.bind(f.provider);

	const id = crypto.randomUUID();

	db.reviews.set(testReview({ id }));

	try {
		await withReviewMetrics(id, 'pipeline', () => chatCompletion(input));

		const chunks: string[] = [];

		await withReviewMetrics(id, 'discussion', () => streamChatCompletion(input, (text) => chunks.push(text)));
		expect(chunks).toEqual(['{"findings":', '[]}']);

		expect(getReviewMetrics(id)?.total).toMatchObject({
			calls: 2,
			failedCalls: 0,
			usage: { inputTokens: 200, outputTokens: 60, totalTokens: 260, cachedInputTokens: 40, reasoningOutputTokens: 20 }
		});

		expect(getReviewMetrics(id)?.models).toHaveLength(1);
		limited = true;

		const error = await withReviewMetrics(id, 'pipeline', () => chatCompletion(input)).catch((error) => error);

		expect(error).toBeInstanceOf(LlmError);
		expect(error.status).toBe(429);
		expect(getReviewMetrics(id)?.total).toMatchObject({ calls: 3, failedCalls: 1, usage: { totalTokens: 260 } });
	} finally {
		codex.complete = original;
		db.reviews.delete(id);
		reviewMetrics.delete(id);
	}
});

test('model discovery reads effort levels and the default from the catalog', async () => {
	const f = fixture({
		handler: (call) =>
			call.url.includes('/codex/models?')
				? Response.json({
						models: [
							{
								slug: 'sol',
								display_name: 'GPT-5.6-Sol',
								visibility: 'list',
								default_reasoning_level: 'medium',
								supported_reasoning_levels: [
									{ effort: 'low', description: 'Fast' },
									{ effort: 'medium', description: 'Balanced' },
									{ effort: 'xhigh', description: 'Extra high' },
									{ effort: 'turbo', description: 'Unknown levels are ignored' }
								]
							},
							{ slug: 'legacy', visibility: 'list', supported_reasoning_efforts: ['minimal', 'high'] }
						]
					})
				: undefined
	});

	expect(await f.provider.models()).toEqual([
		{ id: 'sol', label: 'GPT-5.6-Sol', efforts: ['low', 'medium', 'xhigh'], defaultEffort: 'medium' },
		{ id: 'legacy', label: 'legacy', efforts: ['minimal', 'high'] }
	]);
});
