import { AsyncLocalStorage } from 'node:async_hooks';
import { aggregateTokenCalls, emptyTokenUsage, type ReviewMetrics, type TokenCall, type TokenScope, type TokenUsage } from '@recoder/shared';
import { db, reviewMetrics } from '../store';

// Async context covers nested agent loops/retries without threading review IDs through model config.
const context = new AsyncLocalStorage<{ reviewId: string; scope: TokenScope }>();

export function withReviewMetrics<T>(reviewId: string, scope: TokenScope, run: () => T): T {
	if (db.reviews.get(reviewId) && !reviewMetrics.get(reviewId)) {
		reviewMetrics.set({ id: reviewId, startedAt: new Date().toISOString(), pipelineTracked: scope === 'pipeline', calls: [] });
	}
	return context.run({ reviewId, scope }, run);
}

export function trackTokenCall(model: string, provider: TokenCall['provider']) {
	const owner = context.getStore();
	const call: TokenCall = { id: crypto.randomUUID(), model, provider, scope: owner?.scope ?? 'pipeline', status: 'pending', usage: emptyTokenUsage() };
	const save = () => {
		if (!owner || !db.reviews.get(owner.reviewId)) return;
		const metrics = reviewMetrics.get(owner.reviewId);
		if (!metrics) return;
		const index = metrics.calls.findIndex((item) => item.id === call.id);
		if (index < 0) metrics.calls.push(call);
		else metrics.calls[index] = call;
		reviewMetrics.set(metrics);
	};
	save();
	return {
		usage: (usage: TokenUsage) => { call.usage = usage; save(); },
		finish: (success: boolean) => { call.status = success ? 'completed' : 'failed'; save(); }
	};
}

/** Accept numbers, never coerce null, strings, negative values, or invalid counts to zero. */
export function normalizeTokenUsage(raw: unknown, provider: TokenCall['provider']): TokenUsage {
	const value = raw && typeof raw === 'object' ? raw as Record<string, any> : {};
	const count = (n: unknown): number | null => typeof n === 'number' && Number.isSafeInteger(n) && n >= 0 ? n : null;
	const codex = provider === 'codex';
	const inputTokens = count(codex ? value.inputTokens : value.prompt_tokens);
	const outputTokens = count(codex ? value.outputTokens : value.completion_tokens);
	return {
		inputTokens, outputTokens,
		totalTokens: count(codex ? value.totalTokens : value.total_tokens) ?? (inputTokens !== null && outputTokens !== null ? inputTokens + outputTokens : null),
		cachedInputTokens: count(codex ? value.cachedInputTokens : value.prompt_tokens_details?.cached_tokens),
		cacheWriteInputTokens: count(codex ? value.cacheWriteInputTokens : value.prompt_tokens_details?.cache_write_tokens),
		reasoningOutputTokens: count(codex ? value.reasoningOutputTokens : value.completion_tokens_details?.reasoning_tokens)
	};
}

export function getReviewMetrics(reviewId: string): ReviewMetrics | null {
	const stored = reviewMetrics.get(reviewId);
	if (!stored) return null;
	const models = new Map<string, TokenCall[]>();
	for (const call of stored.calls) {
		const key = JSON.stringify([call.provider, call.model]);
		models.set(key, [...(models.get(key) ?? []), call]);
	}
	return {
		reviewId, startedAt: stored.startedAt, pipelineTracked: stored.pipelineTracked,
		total: aggregateTokenCalls(stored.calls),
		models: [...models.values()].map((calls) => ({ model: calls[0]!.model, provider: calls[0]!.provider, ...aggregateTokenCalls(calls) })),
		scopes: (['pipeline', 'discussion', 'fix'] as const).map((scope) => ({ scope, ...aggregateTokenCalls(stored.calls.filter((call) => call.scope === scope)) }))
	};
}
