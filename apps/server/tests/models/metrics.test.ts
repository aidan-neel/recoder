import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Review } from '@recoder/shared';
import { app } from '../../src/app';
import { closeStore, db, reviewDiffs, reviewMetrics, reviewSandboxes } from '../../src/store';
import { chatCompletion, resetLlmLimiter, streamChatCompletion } from '../../src/models/llm';
import {
	getReviewMetrics,
	normalizeTokenUsage,
	recordTokenBudget,
	trackTokenCall,
	withReviewMetrics,
	withTokenStage
} from '../../src/models/metrics';
import { getStoredSettings, setReviewOverrides } from '../../src/review/session/review-settings';
import { runReviewPipeline } from '../../src/commands/pipeline';
import { claudeCode } from '../../src/agents/claude-code/claude-code';
import { codex } from '../../src/agents/codex/codex';
import { ModelBudget, runJsonAgent } from '../../src/review/pipeline/agent-loop';
import { EvidenceStore } from '../../src/evidence/evidence';
import { buildInventory } from '../../src/review/pipeline/inventory';
import { testReview } from '../helpers/review';

const originalFetch = globalThis.fetch;
const originalSettings = getStoredSettings();
const originalComplete = codex.complete;
const originalClaudeCode = claudeCode.complete;
const ids: string[] = [];

const opts = {
	baseUrl: 'https://model.test/v1',
	apiKey: 'secret-not-for-metrics',
	model: 'model-a',
	messages: [{ role: 'user' as const, content: 'private prompt' }]
};

const usage = {
	prompt_tokens: 100,
	completion_tokens: 30,
	total_tokens: 130,
	prompt_tokens_details: { cached_tokens: 40, cache_write_tokens: 10 },
	completion_tokens_details: { reasoning_tokens: 20 }
};

async function review(): Promise<Review> {
	const value = testReview({ repoId: 'missing-repo', headSha: 'head' });

	ids.push(value.id);

	return await db.reviews.set(value);
}

/** closeStore() reopens SQLite from RECODER_DATA_DIR, so this file owns a temp data dir for its whole run. */
const originalDataDir = process.env.RECODER_DATA_DIR;

beforeAll(async () => {
	process.env.RECODER_DATA_DIR = mkdtempSync(join(tmpdir(), 'recoder-metrics-'));
	await closeStore();
});

afterAll(async () => {
	await closeStore();
	if (originalDataDir === undefined) delete process.env.RECODER_DATA_DIR;
	else process.env.RECODER_DATA_DIR = originalDataDir;
});

beforeEach(() => {
	globalThis.fetch = (async () =>
		Response.json({ choices: [{ message: { content: 'ok' } }], usage })) as unknown as typeof fetch;
});

afterEach(async () => {
	globalThis.fetch = originalFetch;
	codex.complete = originalComplete;
	claudeCode.complete = originalClaudeCode;
	setReviewOverrides(originalSettings);
	resetLlmLimiter();

	for (const id of ids.splice(0)) {
		await db.reviews.delete(id);
		await reviewMetrics.delete(id);
		await reviewDiffs.delete(id);
	}
});

test('concurrent requests remain isolated by review, model and scope and survive reopening SQLite', async () => {
	const a = await review();
	const b = await review();

	await Promise.all([
		await withReviewMetrics(a.id, 'pipeline', () =>
			Promise.all([chatCompletion(opts), chatCompletion({ ...opts, model: 'model-b' })])
		),
		await withReviewMetrics(b.id, 'discussion', () => chatCompletion(opts))
	]);

	await withReviewMetrics(a.id, 'fix', () => chatCompletion(opts));
	await closeStore();

	const metrics = (await getReviewMetrics(a.id))!;

	expect(metrics.pipelineTracked).toBe(true);

	expect(metrics.total).toMatchObject({
		calls: 3,
		pendingCalls: 0,
		usage: { inputTokens: 300, outputTokens: 90, totalTokens: 390 },
		reportedCalls: { totalTokens: 3 }
	});

	expect(metrics.models.map((model) => [model.model, model.calls])).toEqual([
		['model-a', 2],
		['model-b', 1]
	]);

	expect(metrics.scopes.map((scope) => [scope.scope, scope.calls])).toEqual([
		['pipeline', 2],
		['discussion', 0],
		['fix', 1]
	]);

	expect(await getReviewMetrics(b.id)).toMatchObject({ pipelineTracked: false, total: { calls: 1 } });
	expect(JSON.stringify(await reviewMetrics.get(a.id))).not.toContain('private prompt');
	expect(JSON.stringify(await reviewMetrics.get(a.id))).not.toContain(opts.apiKey);
});

test('a review’s metrics name the token budget of its latest pipeline run, and a run outside the pipeline records none', async () => {
	const a = await review();

	await withReviewMetrics(a.id, 'pipeline', () => recordTokenBudget('low'));
	expect((await getReviewMetrics(a.id))?.tokenBudget).toBe('low');
	await withReviewMetrics(a.id, 'pipeline', () => recordTokenBudget('high'));
	expect((await getReviewMetrics(a.id))?.tokenBudget).toBe('high');
	await withReviewMetrics(a.id, 'discussion', () => recordTokenBudget('low'));
	expect((await getReviewMetrics(a.id))?.tokenBudget).toBe('high');
});

test('concurrent calls keep their own stage, an inner stage wins, and a call outside any stage counts as other', async () => {
	const a = await review();

	await withReviewMetrics(a.id, 'pipeline', () =>
		Promise.all([
			withTokenStage('reviewer', () =>
				Promise.all([chatCompletion(opts), withTokenStage('worker', () => chatCompletion(opts))])
			),
			withTokenStage('verifier', () => chatCompletion(opts)),
			chatCompletion(opts)
		])
	);

	expect((await getReviewMetrics(a.id))!.stages.map((stage) => [stage.stage, stage.calls])).toEqual([
		['reviewer', 1],
		['worker', 1],
		['verifier', 1],
		['other', 1]
	]);
});

test('streaming requests request usage and replace cumulative reports, including a usage-only chunk', async () => {
	const a = await review();

	globalThis.fetch = (async (_url, init) => {
		expect(JSON.parse(init!.body as string).stream_options).toEqual({ include_usage: true });

		const chunks = [
			'data: {"choices":[{"delta":{"content":"ok"}}]}\n\n',
			`data: ${JSON.stringify({ choices: [], usage })}\n\n`,
			`data: ${JSON.stringify({ choices: [], usage: { ...usage, total_tokens: 140, completion_tokens: 40 } })}\n\n`,
			'data: [DONE]\n\n'
		];

		return new Response(
			new ReadableStream({
				start(controller) {
					for (const chunk of chunks) {
						const bytes = new TextEncoder().encode(chunk);

						controller.enqueue(bytes.slice(0, 7));
						controller.enqueue(bytes.slice(7));
					}

					controller.close();
				}
			})
		);
	}) as typeof fetch;

	const tokens: string[] = [];

	expect(
		await withReviewMetrics(a.id, 'discussion', () => streamChatCompletion(opts, (token) => tokens.push(token)))
	).toBe('ok');

	expect(tokens).toEqual(['ok']);

	expect((await getReviewMetrics(a.id))?.total).toMatchObject({
		calls: 1,
		usage: { totalTokens: 140, outputTokens: 40 }
	});
});

test('final usage without a trailing newline is retained at stream EOF', async () => {
	const a = await review();

	globalThis.fetch = (async () =>
		new Response(
			`data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: ${JSON.stringify({ usage })}`
		)) as unknown as typeof fetch;

	await withReviewMetrics(a.id, 'discussion', () => streamChatCompletion(opts, () => {}));
	expect((await getReviewMetrics(a.id))?.total.usage.totalTokens).toBe(130);
});

test.each([{ choices: [{ finish_reason: 'length' }] }, { error: { message: 'Provider stream failed' } }])(
	'stream failures retain final reported usage and count as failed requests: %j',
	async (failure) => {
		const a = await review();

		globalThis.fetch = (async () =>
			new Response(
				[
					'data: {"choices":[{"delta":{"content":"partial"}}]}',
					`data: ${JSON.stringify(failure)}`,
					`data: ${JSON.stringify({ choices: [], usage })}`,
					'data: [DONE]\n'
				].join('\n\n')
			)) as unknown as typeof fetch;

		await expect(withReviewMetrics(a.id, 'discussion', () => streamChatCompletion(opts, () => {}))).rejects.toThrow();

		expect((await getReviewMetrics(a.id))?.total).toMatchObject({
			calls: 1,
			failedCalls: 1,
			pendingCalls: 0,
			usage: { totalTokens: 130, cachedInputTokens: 40, reasoningOutputTokens: 20 }
		});
	}
);

test('cancellation before acquiring capacity does not invent a model request', async () => {
	const a = await review();
	const signal = AbortSignal.abort();

	await withReviewMetrics(a.id, 'pipeline', async () => {
		await expect(chatCompletion({ ...opts, signal })).rejects.toThrow('cancelled');
		await expect(streamChatCompletion({ ...opts, signal }, () => {})).rejects.toThrow('cancelled');
	});

	expect((await getReviewMetrics(a.id))?.total).toMatchObject({ calls: 0, usage: { totalTokens: null } });
});

test('Codex chat and streaming followups each count once and separate the same model across providers', async () => {
	const a = await review();

	codex.complete = async (options, onToken) => {
		onToken?.('o');
		options.onUsage?.(normalizeTokenUsage({ prompt_tokens: 50, completion_tokens: 10 }));
		onToken?.('k');
		options.onUsage?.(normalizeTokenUsage({ prompt_tokens: 100, completion_tokens: 30 }));

		return 'ok';
	};

	await withReviewMetrics(a.id, 'pipeline', () => chatCompletion({ ...opts, provider: 'codex' }));

	const chunks: string[] = [];

	await withReviewMetrics(a.id, 'discussion', () =>
		streamChatCompletion({ ...opts, provider: 'codex' }, (text) => chunks.push(text))
	);

	expect(chunks).toEqual(['o', 'k']);
	await withReviewMetrics(a.id, 'discussion', () => chatCompletion(opts));

	expect(
		(await getReviewMetrics(a.id))?.models.map((model) => [model.provider, model.calls, model.usage.totalTokens])
	).toEqual([
		['codex', 2, 260],
		['openai-compatible', 1, 130]
	]);
});

test('a Claude Code call records what paid for it on its call record', async () => {
	const a = await review();

	claudeCode.complete = async (options) => {
		options.onApiKeySource?.('none');

		return 'ok';
	};

	await withReviewMetrics(a.id, 'pipeline', () =>
		chatCompletion({ ...opts, provider: 'claude-code', baseUrl: '', apiKey: '' })
	);

	expect((await reviewMetrics.get(a.id))?.calls).toEqual([
		expect.objectContaining({ provider: 'claude-code', status: 'completed', apiKeySource: 'none' })
	]);
});

test('nested agent retries count all provider calls, not just the accepted JSON result', async () => {
	const a = await review();
	let requests = 0;

	globalThis.fetch = (async () =>
		Response.json({
			choices: [{ message: { content: ++requests === 1 ? 'invalid JSON' : '{"ok":true}' } }],
			usage
		})) as unknown as typeof fetch;

	await withReviewMetrics(a.id, 'pipeline', () =>
		runJsonAgent({
			label: 'reviewer',
			stage: 'reviewer',
			system: '',
			user: '',
			config: opts,
			budget: new ModelBudget(),
			evidence: new EvidenceStore(null, buildInventory(''), 1000),
			maxTurns: 2,
			signal: new AbortController().signal,
			deadlineAt: Date.now() + 120000,
			parse: (value) =>
				value as {
					ok: boolean;
				}
		})
	);

	expect(requests).toBe(2);
	expect((await getReviewMetrics(a.id))?.total).toMatchObject({ calls: 2, usage: { totalTokens: 260 } });
});

test('missing usage stays unavailable; partial coverage and failed/truncated requests are counted honestly', async () => {
	const a = await review();

	await withReviewMetrics(a.id, 'pipeline', async () => {
		await chatCompletion(opts);

		globalThis.fetch = (async () =>
			Response.json({ choices: [{ message: { content: 'ok' } }] })) as unknown as typeof fetch;

		await chatCompletion(opts);

		globalThis.fetch = (async () =>
			Response.json({
				choices: [{ finish_reason: 'length', message: { content: 'partial' } }],
				usage
			})) as unknown as typeof fetch;

		await expect(chatCompletion(opts)).rejects.toThrow('truncated');
		globalThis.fetch = (async () => new Response('provider down', { status: 503 })) as unknown as typeof fetch;
		await expect(chatCompletion(opts)).rejects.toThrow('503');
	});

	expect((await getReviewMetrics(a.id))?.total).toMatchObject({
		calls: 4,
		failedCalls: 2,
		usage: { totalTokens: 260 },
		reportedCalls: { totalTokens: 2 }
	});

	const b = await review();

	globalThis.fetch = (async () =>
		new Response('data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n')) as unknown as typeof fetch;

	await withReviewMetrics(b.id, 'discussion', () => streamChatCompletion(opts, () => {}));

	expect((await getReviewMetrics(b.id))?.total).toMatchObject({
		calls: 1,
		usage: { totalTokens: null, inputTokens: null },
		reportedCalls: { totalTokens: 0 }
	});
});

test('a call the provider rejects is stored as failed with its error text, without the key it was sent', async () => {
	const a = await review();

	globalThis.fetch = (async () =>
		new Response(`{"error":"key ${opts.apiKey} is over its quota"}`, { status: 400 })) as unknown as typeof fetch;

	await withReviewMetrics(a.id, 'pipeline', () => expect(chatCompletion(opts)).rejects.toThrow());

	const [call] = (await reviewMetrics.get(a.id))?.calls ?? [];

	expect(call?.status).toBe('failed');
	expect(call?.error).toBe('LLM 400: {"error":"key [redacted] is over its quota"}');
});

test('interrupted calls keep reported usage durably and cannot recreate deleted reviews', async () => {
	const a = await review();
	const call = await withReviewMetrics(a.id, 'pipeline', () => trackTokenCall('model-a', 'codex'));

	call.usage(normalizeTokenUsage({ prompt_tokens: 100, completion_tokens: 10 }));
	await closeStore();
	expect((await getReviewMetrics(a.id))?.total).toMatchObject({ pendingCalls: 1, usage: { totalTokens: 110 } });
	await db.reviews.delete(a.id);
	await reviewMetrics.delete(a.id);
	call.complete();
	expect(await getReviewMetrics(a.id)).toBeNull();
});

test('metrics API distinguishes untracked, tracked with no calls (a pipeline that failed before model work), and nonexistent reviews', async () => {
	const a = await review();
	const response = await app.request(`/api/reviews/${a.id}/metrics`);

	expect(response.status).toBe(200);
	expect(response.headers.get('cache-control')).toBe('no-store');
	expect(await response.json()).toBeNull();
	await runReviewPipeline(a.id);

	const metrics = await (await app.request(`/api/reviews/${a.id}/metrics`)).json();

	expect(metrics).toMatchObject({ pipelineTracked: true, total: { calls: 0, usage: { totalTokens: null } } });
	expect((await app.request('/api/reviews/does-not-exist/metrics')).status).toBe(404);
	await app.request(`/api/reviews/${a.id}`, { method: 'DELETE' });
	expect(await reviewMetrics.get(a.id)).toBeUndefined();
});

test('discussion, streaming discussion and fix routes all record follow-up scope', async () => {
	const a = await review();

	await reviewDiffs.set(
		a.id,
		'diff --git a/test.ts b/test.ts\n--- a/test.ts\n+++ b/test.ts\n@@ -1 +1 @@\n-old\n+new\n'
	);

	const checkout = mkdtempSync(join(tmpdir(), 'recoder-metrics-fix-'));

	mkdirSync(join(checkout, '.git'));
	writeFileSync(join(checkout, 'test.ts'), 'new\n');
	reviewSandboxes.set(a.id, checkout);

	setReviewOverrides({
		models: [{ id: 'test', label: 'Test', model: opts.model, baseUrl: opts.baseUrl, apiKey: opts.apiKey }],
		sharedModelId: 'test'
	});

	globalThis.fetch = (async (_url, init) => {
		const body = JSON.parse(init!.body as string);

		return body.stream
			? new Response(
					`data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: ${JSON.stringify({ choices: [], usage })}\n\ndata: [DONE]\n\n`
				)
			: Response.json({
					choices: [
						{
							message: {
								content: JSON.stringify({ summary: 'Fix', edits: [{ file: 'test.ts', find: 'new', replace: 'newer' }] })
							}
						}
					],
					usage
				});
	}) as typeof fetch;

	for (const path of ['discuss', 'discuss/stream', 'fixes/suggest']) {
		const res = await app.request(`/api/reviews/${a.id}/${path}`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				agent: 'security',
				finding: { file: 'test.ts', line: 1, endLine: 1, severity: 'warning', message: 'Issue' },
				question: 'Why?',
				history: []
			})
		});

		expect(res.status).toBe(200);
		await res.text();
	}

	const metrics = (await getReviewMetrics(a.id))!;

	expect(metrics.pipelineTracked).toBe(false);
	expect(metrics.total.calls).toBe(3);
	expect(metrics.scopes.map((scope) => scope.calls)).toEqual([0, 2, 1]);
});
