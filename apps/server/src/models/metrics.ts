import { AsyncLocalStorage } from 'node:async_hooks';
import {
	aggregateTokenCalls,
	emptyTokenUsage,
	type ReviewMetrics,
	type TokenCall,
	type TokenScope,
	type TokenUsage
} from '@recoder/shared';
import { db, reviewMetrics } from '../store';

/** Async context covers nested agent loops and retries without threading review IDs through model config. */
const context = new AsyncLocalStorage<{ reviewId: string; scope: TokenScope }>();

export function withReviewMetrics<T>(reviewId: string, scope: TokenScope, run: () => T): T {
	if (db.reviews.get(reviewId) && !reviewMetrics.get(reviewId)) {
		reviewMetrics.set({
			id: reviewId,
			startedAt: new Date().toISOString(),
			pipelineTracked: scope === 'pipeline',
			calls: []
		});
	}

	return context.run({ reviewId, scope }, run);
}

/** Output tokens one piece of work spent; null until a provider reports a count. */
export interface TokenTally {
	outputTokens: number | null;
}

const tallies = new AsyncLocalStorage<TokenTally>();

/** Run `run` with every model call it starts, however nested, adding its output tokens to `tally`. */
export function withTokenTally<T>(tally: TokenTally, run: () => T): T {
	return tallies.run(tally, run);
}

export function trackTokenCall(model: string, provider: TokenCall['provider']) {
	const owner = context.getStore();
	const tally = tallies.getStore();

	const call: TokenCall = {
		id: crypto.randomUUID(),
		model,
		provider,
		scope: owner?.scope ?? 'pipeline',
		status: 'pending',
		usage: emptyTokenUsage()
	};

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
		usage: (usage: TokenUsage) => {
			if (tally && usage.outputTokens !== null) {
				tally.outputTokens = (tally.outputTokens ?? 0) + usage.outputTokens - (call.usage.outputTokens ?? 0);
			}

			call.usage = usage;
			save();
		},
		finish: (success: boolean) => {
			call.status = success ? 'completed' : 'failed';
			save();
		}
	};
}

/** `raw[key]` when `raw` is a non-null object, else undefined. */
function field(raw: unknown, key: string): unknown {
	return raw && typeof raw === 'object' ? (raw as Record<string, unknown>)[key] : undefined;
}

/** Accept numbers, never coerce null, strings, negative values, or invalid counts to zero. */
export function normalizeTokenUsage(raw: unknown, provider: TokenCall['provider']): TokenUsage {
	const count = (n: unknown): number | null => (typeof n === 'number' && Number.isSafeInteger(n) && n >= 0 ? n : null);
	const codex = provider === 'codex';
	const read = (codexKey: string, openAiKey: string) => count(field(raw, codex ? codexKey : openAiKey));
	const promptDetails = field(raw, 'prompt_tokens_details');
	const inputTokens = read('inputTokens', 'prompt_tokens');
	const outputTokens = read('outputTokens', 'completion_tokens');

	return {
		inputTokens,
		outputTokens,
		totalTokens:
			read('totalTokens', 'total_tokens') ??
			(inputTokens !== null && outputTokens !== null ? inputTokens + outputTokens : null),
		cachedInputTokens: count(codex ? field(raw, 'cachedInputTokens') : field(promptDetails, 'cached_tokens')),
		cacheWriteInputTokens: count(
			codex ? field(raw, 'cacheWriteInputTokens') : field(promptDetails, 'cache_write_tokens')
		),
		reasoningOutputTokens: count(
			codex ? field(raw, 'reasoningOutputTokens') : field(field(raw, 'completion_tokens_details'), 'reasoning_tokens')
		)
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
		reviewId,
		startedAt: stored.startedAt,
		pipelineTracked: stored.pipelineTracked,
		total: aggregateTokenCalls(stored.calls),
		models: [...models.values()].map((calls) => ({
			model: calls[0]!.model,
			provider: calls[0]!.provider,
			...aggregateTokenCalls(calls)
		})),
		scopes: (['pipeline', 'discussion', 'fix'] as const).map((scope) => ({
			scope,
			...aggregateTokenCalls(stored.calls.filter((call) => call.scope === scope))
		}))
	};
}
