import { afterEach, expect, test } from 'bun:test';
import { emptyTokenUsage, type ModelCallRow, type Review, type TokenUsage } from '@recoder/shared';
import { db, modelCalls, reviewMetrics } from '../../src/store';
import { chatCompletion, resetLlmLimiter } from '../../src/models/llm';
import { normalizeTokenUsage, trackTokenCall, withUsageMetrics, type StoredMetrics } from '../../src/models/metrics';
import { backfillModelCalls, MODEL_CALL_KEEP_DAYS, pruneModelCalls } from '../../src/usage/model-calls';
import { loadUsageReport } from '../../src/usage/usage-load';
import { newChat } from '../../src/repo-chat/chat-record';
import { CHAT_OPTIONS as opts, useMetricsStore } from '../helpers/metrics-store';
import { testReview } from '../helpers/review';

useMetricsStore('recoder-model-calls-');

const reviewIds: string[] = [];
const chatIds: string[] = [];
const metricIds: string[] = [];

afterEach(async () => {
	resetLlmLimiter();

	for (const id of reviewIds.splice(0)) await db.reviews.delete(id);
	for (const id of chatIds.splice(0)) await db.repoChats.delete(id);
	for (const id of metricIds.splice(0)) await reviewMetrics.delete(id);

	await modelCalls.clear();
});

async function review(overrides: Partial<Review> = {}): Promise<Review> {
	const value = testReview(overrides);

	reviewIds.push(value.id);
	metricIds.push(value.id);

	return await db.reviews.set(value);
}

/** A stored call row for seeding `model_calls` or `review_metrics` directly. */
function storedCall(overrides: Partial<ModelCallRow> = {}): ModelCallRow {
	return {
		id: crypto.randomUUID(),
		at: new Date().toISOString(),
		person: null,
		kind: 'other',
		ownerId: null,
		provider: 'openai-compatible',
		model: 'model-a',
		usage: emptyTokenUsage(),
		outcome: 'ok',
		...overrides
	};
}

function counts(tokens: Partial<TokenUsage>): TokenUsage {
	return { ...emptyTokenUsage(), ...tokens };
}

test('a call under a review writes one row with its person, kind, model, effort and token counts', async () => {
	const a = await review({ startedBy: 'member:github::hubot' });

	await withUsageMetrics(a.id, 'pipeline', () => chatCompletion({ ...opts, reasoningEffort: 'high' }));

	const rows = await modelCalls.list();

	expect(rows).toHaveLength(1);

	expect(rows[0]).toMatchObject({
		person: 'member:github::hubot',
		kind: 'review',
		ownerId: a.id,
		provider: 'openai-compatible',
		model: 'model-a',
		effort: 'high',
		outcome: 'ok',
		usage: {
			inputTokens: 100,
			outputTokens: 30,
			totalTokens: 130,
			cachedInputTokens: 40,
			cacheWriteInputTokens: 10,
			reasoningOutputTokens: 20
		}
	});

	expect(Date.parse(rows[0]!.at)).not.toBeNaN();
	expect(rows[0]!.durationMs).toBeGreaterThanOrEqual(0);
	expect(JSON.stringify(rows[0])).not.toContain('private prompt');
	expect(JSON.stringify(rows[0])).not.toContain(opts.apiKey);
});

test('a repository chat’s call records kind chat with its starter, and a call outside either records other', async () => {
	const chat = await db.repoChats.set(newChat('repo', 'Chat', new Date().toISOString(), 'member:github::hubot'));

	chatIds.push(chat.id);
	metricIds.push(chat.id);

	await withUsageMetrics(chat.id, 'discussion', () => chatCompletion(opts));
	await chatCompletion(opts);

	const rows = await modelCalls.list();

	expect(rows).toHaveLength(2);

	expect(rows.find((row) => row.ownerId === chat.id)).toMatchObject({
		kind: 'chat',
		person: 'member:github::hubot',
		model: 'model-a',
		outcome: 'ok'
	});

	expect(rows.find((row) => row.kind === 'other')).toMatchObject({ ownerId: null, person: null, outcome: 'ok' });
});

test('a failed call is recorded as failed with a short error kind, without the key it was sent', async () => {
	const a = await review({ startedBy: 'member:github::hubot' });

	globalThis.fetch = (async () =>
		new Response(`provider down for key ${opts.apiKey}`, { status: 503 })) as unknown as typeof fetch;

	await withUsageMetrics(a.id, 'pipeline', () => expect(chatCompletion(opts)).rejects.toThrow());

	const rows = await modelCalls.list();

	expect(rows).toHaveLength(1);
	expect(rows[0]).toMatchObject({ kind: 'review', outcome: 'failed', errorKind: 'provider' });
	expect(JSON.stringify(rows[0])).not.toContain(opts.apiKey);
});

test('a cancelled call is recorded as cancelled, not failed', async () => {
	const a = await review({});
	const signal = new AbortController();

	globalThis.fetch = (async () => {
		signal.abort();

		return new Promise<Response>(() => {});
	}) as unknown as typeof fetch;

	await expect(
		withUsageMetrics(a.id, 'pipeline', () => chatCompletion({ ...opts, signal: signal.signal }))
	).rejects.toThrow();

	const rows = await modelCalls.list();

	expect(rows).toHaveLength(1);
	expect(rows[0]).toMatchObject({ outcome: 'cancelled' });
	expect(rows[0]).not.toHaveProperty('errorKind');
});

test('a tracked call outside any owner writes its row once it settles', async () => {
	const call = trackTokenCall('model-a', 'codex');

	call.usage(normalizeTokenUsage({ prompt_tokens: 50, completion_tokens: 5 }));
	call.complete();
	await call.flush();

	const rows = await modelCalls.list();

	expect(rows).toHaveLength(1);

	expect(rows[0]).toMatchObject({
		kind: 'other',
		ownerId: null,
		person: null,
		provider: 'codex',
		outcome: 'ok',
		usage: { inputTokens: 50, outputTokens: 5 }
	});
});

test('backfill copies stored metrics calls once, with their kind, person, worker and outcome', async () => {
	const a = await review({ startedBy: 'member:github::hubot' });
	const chat = await db.repoChats.set(newChat('repo', 'Chat', new Date().toISOString(), 'member:github::hubot'));

	chatIds.push(chat.id);
	metricIds.push(chat.id, 'orphan');

	const metrics = (id: string, calls: StoredMetrics['calls']): StoredMetrics => ({
		id,
		startedAt: '2026-01-05T08:00:00.000Z',
		pipelineTracked: true,
		calls,
		runs: [
			{
				index: 0,
				startedAt: '2026-01-05T08:00:00.000Z',
				orchestrator: null,
				subagent: null,
				lockMisses: 0,
				worker: 'worker-a'
			}
		]
	});

	await reviewMetrics.set(
		metrics(a.id, [
			{
				id: 'call-ok',
				at: '2026-01-05T08:01:00.000Z',
				model: 'opus',
				provider: 'claude-code',
				scope: 'pipeline',
				status: 'completed',
				usage: counts({ inputTokens: 100, outputTokens: 10 }),
				run: 0
			},
			{
				id: 'call-fail',
				model: 'opus',
				provider: 'claude-code',
				scope: 'pipeline',
				status: 'failed',
				error: 'LLM 429: rate limited',
				usage: emptyTokenUsage(),
				run: 0
			},
			{
				id: 'call-pending',
				model: 'opus',
				provider: 'claude-code',
				scope: 'discussion',
				status: 'pending',
				usage: emptyTokenUsage()
			}
		])
	);

	await reviewMetrics.set(
		metrics(chat.id, [
			{
				id: 'call-chat',
				at: '2026-01-05T09:00:00.000Z',
				model: 'glm',
				provider: 'openai-compatible',
				scope: 'discussion',
				status: 'completed',
				usage: counts({ inputTokens: 10 })
			}
		])
	);

	await reviewMetrics.set(
		metrics('orphan', [
			{
				id: 'call-orphan',
				at: '2026-01-05T10:00:00.000Z',
				model: 'opus',
				provider: 'openai-compatible',
				scope: 'pipeline',
				status: 'completed',
				usage: counts({ inputTokens: 5 })
			}
		])
	);

	expect(await backfillModelCalls()).toBe(5);
	expect(await backfillModelCalls()).toBe(0);

	const rows = await modelCalls.list();
	const byId = new Map(rows.map((row) => [row.id, row]));

	expect(rows).toHaveLength(5);

	expect(byId.get('call-ok')).toMatchObject({
		kind: 'review',
		ownerId: a.id,
		person: 'member:github::hubot',
		outcome: 'ok',
		worker: 'worker-a',
		usage: { inputTokens: 100 }
	});

	expect(byId.get('call-fail')).toMatchObject({ outcome: 'failed', errorKind: 'rate-limit' });
	expect(byId.get('call-pending')).toMatchObject({ outcome: 'cancelled', at: '2026-01-05T08:00:00.000Z' });
	expect(byId.get('call-chat')).toMatchObject({ kind: 'chat', ownerId: chat.id });
	expect(byId.get('call-orphan')).toMatchObject({ kind: 'other', ownerId: null, person: null });
});

test('prune drops rows older than the keep window and keeps newer ones', async () => {
	const dayMs = 24 * 60 * 60 * 1000;

	await modelCalls.set(
		storedCall({ id: 'old', at: new Date(Date.now() - (MODEL_CALL_KEEP_DAYS + 1) * dayMs).toISOString() })
	);

	await modelCalls.set(storedCall({ id: 'new', at: new Date(Date.now() - 10 * dayMs).toISOString() }));

	expect(await pruneModelCalls()).toBe(1);
	expect((await modelCalls.list()).map((row) => row.id)).toEqual(['new']);
});

test('the usage report totals the recorded rows by kind and counts their failures', async () => {
	const now = new Date('2026-11-13T15:00:00.000Z');
	const at = '2026-11-13T10:00:00.000Z';

	await modelCalls.set(
		storedCall({
			kind: 'review',
			ownerId: 'review-a',
			person: 'member:github::hubot',
			at,
			usage: counts({ inputTokens: 100, outputTokens: 50 }),
			durationMs: 2_000
		})
	);

	await modelCalls.set(
		storedCall({
			kind: 'review',
			ownerId: 'review-a',
			person: 'member:github::hubot',
			at,
			usage: counts({ inputTokens: 10 }),
			outcome: 'failed',
			durationMs: 4_000
		})
	);

	await modelCalls.set(storedCall({ kind: 'other', at, usage: counts({ inputTokens: 30, outputTokens: 10 }) }));

	const report = await loadUsageReport(7, now);

	expect(report.totals).toMatchObject({ tokens: 200, calls: 3, failedCalls: 1, sessions: 1, medianDurationMs: 3_000 });

	expect(report.kinds.map((kind) => [kind.kind, kind.calls, kind.tokens])).toEqual([
		['review', 2, 160],
		['chat', 0, 0],
		['other', 1, 40]
	]);
});
