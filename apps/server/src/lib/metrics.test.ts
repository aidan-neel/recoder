import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Review } from '@recoder/shared';
import { app } from '../app';
import { closeStore, db, reviewDiffs, reviewMetrics, reviewSandboxes } from '../store';
import { chatCompletion, resetLlmLimiter, streamChatCompletion } from './llm';
import { getReviewMetrics, normalizeTokenUsage, trackTokenCall, withReviewMetrics } from './metrics';
import { getStoredSettings, setReviewOverrides } from './review-settings';
import { runReviewPipeline } from '../commands/pipeline';
import { codex } from './codex';
import { ModelBudget, runJsonAgent } from './agent-loop';
import { EvidenceStore } from './evidence';
import { buildInventory } from './inventory';

const originalFetch = globalThis.fetch;
const originalSettings = getStoredSettings();
const originalComplete = codex.complete;
const ids: string[] = [];
const opts = { baseUrl: 'https://model.test/v1', apiKey: 'secret-not-for-metrics', model: 'model-a', messages: [{ role: 'user' as const, content: 'private prompt' }] };
const usage = { prompt_tokens: 100, completion_tokens: 30, total_tokens: 130, prompt_tokens_details: { cached_tokens: 40, cache_write_tokens: 10 }, completion_tokens_details: { reasoning_tokens: 20 } };

function review(): Review {
	const value: Review = { id: crypto.randomUUID(), repoId: 'missing-repo', prNumber: 1, headSha: 'head', status: 'passed', summary: null, findings: [], runs: [], source: 'github', prTitle: null, prUrl: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
	ids.push(value.id);
	return db.reviews.set(value);
}

const originalDataDir = process.env.RECODER_DATA_DIR;

// closeStore() reopens SQLite from RECODER_DATA_DIR, so own it for the whole file.
beforeAll(() => {
	process.env.RECODER_DATA_DIR = mkdtempSync(join(tmpdir(), 'recoder-metrics-'));
	closeStore();
});
afterAll(() => {
	closeStore();
	if (originalDataDir === undefined) delete process.env.RECODER_DATA_DIR;
	else process.env.RECODER_DATA_DIR = originalDataDir;
});

beforeEach(() => {
	globalThis.fetch = (async () => Response.json({ choices: [{ message: { content: 'ok' } }], usage })) as unknown as typeof fetch;
});
afterEach(() => {
	globalThis.fetch = originalFetch;
	codex.complete = originalComplete;
	setReviewOverrides(originalSettings);
	resetLlmLimiter();
	for (const id of ids.splice(0)) { db.reviews.delete(id); reviewMetrics.delete(id); reviewDiffs.delete(id); }
});

test('normalization preserves missing versus zero and never adds breakdowns to totals', () => {
	expect(normalizeTokenUsage(usage, 'openai-compatible')).toEqual({ inputTokens: 100, outputTokens: 30, totalTokens: 130, cachedInputTokens: 40, cacheWriteInputTokens: 10, reasoningOutputTokens: 20 });
	expect(normalizeTokenUsage({ prompt_tokens: 0, completion_tokens: 0 }, 'openai-compatible')).toMatchObject({ inputTokens: 0, outputTokens: 0, totalTokens: 0, cachedInputTokens: null });
	expect(normalizeTokenUsage({ prompt_tokens: null, completion_tokens: '10', total_tokens: -1 }, 'openai-compatible')).toMatchObject({ inputTokens: null, outputTokens: null, totalTokens: null });
	expect(normalizeTokenUsage({ inputTokens: 10, outputTokens: 5, totalTokens: 17, cachedInputTokens: 3, cacheWriteInputTokens: 2, reasoningOutputTokens: 4 }, 'codex')).toMatchObject({ totalTokens: 17, cachedInputTokens: 3, cacheWriteInputTokens: 2, reasoningOutputTokens: 4 });
});

test('concurrent requests remain isolated by review, model and scope and survive reopening SQLite', async () => {
	const a = review(); const b = review();
	await Promise.all([
		withReviewMetrics(a.id, 'pipeline', () => Promise.all([chatCompletion(opts), chatCompletion({ ...opts, model: 'model-b' })])),
		withReviewMetrics(b.id, 'discussion', () => chatCompletion(opts))
	]);
	await withReviewMetrics(a.id, 'fix', () => chatCompletion(opts));
	closeStore();
	const metrics = getReviewMetrics(a.id)!;
	expect(metrics.pipelineTracked).toBe(true);
	expect(metrics.total).toMatchObject({ calls: 3, pendingCalls: 0, usage: { inputTokens: 300, outputTokens: 90, totalTokens: 390 }, reportedCalls: { totalTokens: 3 } });
	expect(metrics.models.map((model) => [model.model, model.calls])).toEqual([['model-a', 2], ['model-b', 1]]);
	expect(metrics.scopes.map((scope) => [scope.scope, scope.calls])).toEqual([['pipeline', 2], ['discussion', 0], ['fix', 1]]);
	expect(getReviewMetrics(b.id)).toMatchObject({ pipelineTracked: false, total: { calls: 1 } });
	expect(JSON.stringify(reviewMetrics.get(a.id))).not.toContain('private prompt');
	expect(JSON.stringify(reviewMetrics.get(a.id))).not.toContain(opts.apiKey);
});

test('streaming requests request usage and replace cumulative reports, including a usage-only chunk', async () => {
	const a = review();
	globalThis.fetch = (async (_url, init) => {
		expect(JSON.parse(init!.body as string).stream_options).toEqual({ include_usage: true });
		const chunks = [
			'data: {"choices":[{"delta":{"content":"ok"}}]}\n\n',
			`data: ${JSON.stringify({ choices: [], usage })}\n\n`,
			`data: ${JSON.stringify({ choices: [], usage: { ...usage, total_tokens: 140, completion_tokens: 40 } })}\n\n`,
			'data: [DONE]\n\n'
		];
		return new Response(new ReadableStream({ start(controller) { for (const chunk of chunks) { const bytes = new TextEncoder().encode(chunk); controller.enqueue(bytes.slice(0, 7)); controller.enqueue(bytes.slice(7)); } controller.close(); } }));
	}) as typeof fetch;
	const tokens: string[] = [];
	expect(await withReviewMetrics(a.id, 'discussion', () => streamChatCompletion(opts, (token) => tokens.push(token)))).toBe('ok');
	expect(tokens).toEqual(['ok']);
	expect(getReviewMetrics(a.id)?.total).toMatchObject({ calls: 1, usage: { totalTokens: 140, outputTokens: 40 } });
});

test('final usage without a trailing newline is retained at stream EOF', async () => {
	const a = review();
	globalThis.fetch = (async () => new Response(`data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: ${JSON.stringify({ usage })}`)) as unknown as typeof fetch;
	await withReviewMetrics(a.id, 'discussion', () => streamChatCompletion(opts, () => {}));
	expect(getReviewMetrics(a.id)?.total.usage.totalTokens).toBe(130);
});

test.each([
	{ choices: [{ finish_reason: 'length' }] },
	{ error: { message: 'Provider stream failed' } }
])('stream failures retain final reported usage and count as failed requests: %j', async (failure) => {
	const a = review();
	globalThis.fetch = (async () => new Response([
		'data: {"choices":[{"delta":{"content":"partial"}}]}',
		`data: ${JSON.stringify(failure)}`,
		`data: ${JSON.stringify({ choices: [], usage })}`,
		'data: [DONE]\n'
	].join('\n\n'))) as unknown as typeof fetch;
	await expect(withReviewMetrics(a.id, 'discussion', () => streamChatCompletion(opts, () => {}))).rejects.toThrow();
	expect(getReviewMetrics(a.id)?.total).toMatchObject({ calls: 1, failedCalls: 1, pendingCalls: 0, usage: { totalTokens: 130, cachedInputTokens: 40, reasoningOutputTokens: 20 } });
});

test('cancellation before acquiring capacity does not invent a model request', async () => {
	const a = review();
	const signal = AbortSignal.abort();
	await withReviewMetrics(a.id, 'pipeline', async () => {
		await expect(chatCompletion({ ...opts, signal })).rejects.toThrow('cancelled');
		await expect(streamChatCompletion({ ...opts, signal }, () => {})).rejects.toThrow('cancelled');
	});
	expect(getReviewMetrics(a.id)?.total).toMatchObject({ calls: 0, usage: { totalTokens: null } });
});

test('Codex chat and streaming followups each count once and separate the same model across providers', async () => {
	const a = review();
	codex.complete = async (options, onToken) => {
		onToken?.('o');
		options.onUsage?.(normalizeTokenUsage({ inputTokens: 50, outputTokens: 10 }, 'codex'));
		onToken?.('k');
		options.onUsage?.(normalizeTokenUsage({ inputTokens: 100, outputTokens: 30 }, 'codex'));
		return 'ok';
	};
	await withReviewMetrics(a.id, 'pipeline', () => chatCompletion({ ...opts, provider: 'codex' }));
	const chunks: string[] = [];
	await withReviewMetrics(a.id, 'discussion', () => streamChatCompletion({ ...opts, provider: 'codex' }, (text) => chunks.push(text)));
	expect(chunks).toEqual(['o', 'k']);
	await withReviewMetrics(a.id, 'discussion', () => chatCompletion(opts));
	expect(getReviewMetrics(a.id)?.models.map((model) => [model.provider, model.calls, model.usage.totalTokens])).toEqual([['codex', 2, 260], ['openai-compatible', 1, 130]]);
});

test('nested agent retries count all provider calls, not just the accepted JSON result', async () => {
	const a = review();
	let requests = 0;
	globalThis.fetch = (async () => Response.json({ choices: [{ message: { content: ++requests === 1 ? 'invalid JSON' : '{"ok":true}' } }], usage })) as unknown as typeof fetch;
	await withReviewMetrics(a.id, 'pipeline', () => runJsonAgent({
		label: 'planner', system: '', user: '', config: { ...opts, role: 'correctness' },
		budget: new ModelBudget(), evidence: new EvidenceStore(null, buildInventory(''), 1000),
		maxTurns: 2, signal: new AbortController().signal, deadlineAt: Date.now() + 120_000,
		parse: (value) => value as { ok: boolean }
	}));
	expect(requests).toBe(2);
	expect(getReviewMetrics(a.id)?.total).toMatchObject({ calls: 2, usage: { totalTokens: 260 } });
});

test('missing usage stays unavailable; partial coverage and failed/truncated requests are counted honestly', async () => {
	const a = review();
	await withReviewMetrics(a.id, 'pipeline', async () => {
		await chatCompletion(opts);
		globalThis.fetch = (async () => Response.json({ choices: [{ message: { content: 'ok' } }] })) as unknown as typeof fetch;
		await chatCompletion(opts);
		globalThis.fetch = (async () => Response.json({ choices: [{ finish_reason: 'length', message: { content: 'partial' } }], usage })) as unknown as typeof fetch;
		await expect(chatCompletion(opts)).rejects.toThrow('truncated');
		globalThis.fetch = (async () => new Response('provider down', { status: 503 })) as unknown as typeof fetch;
		await expect(chatCompletion(opts)).rejects.toThrow('503');
	});
	expect(getReviewMetrics(a.id)?.total).toMatchObject({ calls: 4, failedCalls: 2, usage: { totalTokens: 260 }, reportedCalls: { totalTokens: 2 } });
	const b = review();
	globalThis.fetch = (async () => new Response('data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n')) as unknown as typeof fetch;
	await withReviewMetrics(b.id, 'discussion', () => streamChatCompletion(opts, () => {}));
	expect(getReviewMetrics(b.id)?.total).toMatchObject({ calls: 1, usage: { totalTokens: null, inputTokens: null }, reportedCalls: { totalTokens: 0 } });
});

test('interrupted calls keep reported usage durably and cannot recreate deleted reviews', () => {
	const a = review();
	const call = withReviewMetrics(a.id, 'pipeline', () => trackTokenCall('model-a', 'codex'));
	call.usage(normalizeTokenUsage({ inputTokens: 100, outputTokens: 10 }, 'codex'));
	closeStore();
	expect(getReviewMetrics(a.id)?.total).toMatchObject({ pendingCalls: 1, usage: { totalTokens: 110 } });
	db.reviews.delete(a.id); reviewMetrics.delete(a.id);
	call.finish(true);
	expect(getReviewMetrics(a.id)).toBeNull();
});

test('metrics API distinguishes historical unavailable, tracked no requests, and nonexistent reviews', async () => {
	const a = review();
	const response = await app.request(`/api/reviews/${a.id}/metrics`);
	expect(response.status).toBe(200);
	expect(response.headers.get('cache-control')).toBe('no-store');
	expect(await response.json()).toBeNull();
	await runReviewPipeline(a.id); // Missing repo fails before model work, but recording was initialized.
	const metrics = await (await app.request(`/api/reviews/${a.id}/metrics`)).json();
	expect(metrics).toMatchObject({ pipelineTracked: true, total: { calls: 0, usage: { totalTokens: null } } });
	expect((await app.request('/api/reviews/does-not-exist/metrics')).status).toBe(404);
	await app.request(`/api/reviews/${a.id}`, { method: 'DELETE' });
	expect(reviewMetrics.get(a.id)).toBeUndefined();
});

test('discussion, streaming discussion and fix routes all record follow-up scope', async () => {
	const a = review();
	reviewDiffs.set(a.id, 'diff --git a/test.ts b/test.ts\n--- a/test.ts\n+++ b/test.ts\n@@ -1 +1 @@\n-old\n+new\n');
	const checkout = mkdtempSync(join(tmpdir(), 'recoder-metrics-fix-'));
	mkdirSync(join(checkout, '.git'));
	writeFileSync(join(checkout, 'test.ts'), 'new\n');
	reviewSandboxes.set(a.id, checkout);
	setReviewOverrides({ models: [{ id: 'test', label: 'Test', model: opts.model, baseUrl: opts.baseUrl, apiKey: opts.apiKey }], sharedModelId: 'test' });
	globalThis.fetch = (async (_url, init) => {
		const body = JSON.parse(init!.body as string);
		return body.stream
			? new Response(`data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: ${JSON.stringify({ choices: [], usage })}\n\ndata: [DONE]\n\n`)
			: Response.json({ choices: [{ message: { content: JSON.stringify({ summary: 'Fix', edits: [{ file: 'test.ts', find: 'new', replace: 'newer' }] }) } }], usage });
	}) as typeof fetch;
	for (const path of ['discuss', 'discuss/stream', 'fixes/suggest']) {
		const res = await app.request(`/api/reviews/${a.id}/${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ agent: 'security', finding: { file: 'test.ts', line: 1, endLine: 1, severity: 'warning', message: 'Issue' }, question: 'Why?', history: [] }) });
		expect(res.status).toBe(200);
		await res.text();
	}
	const metrics = getReviewMetrics(a.id)!;
	expect(metrics.pipelineTracked).toBe(false);
	expect(metrics.total.calls).toBe(3);
	expect(metrics.scopes.map((scope) => scope.calls)).toEqual([0, 2, 1]);
});
