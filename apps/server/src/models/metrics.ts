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
import { lockedModels } from './llm/locked-models';

/**
 * One run of the pipeline under a review. A replay, reverify, continue or rerun runs it again on the same
 * review, so a review's metrics can hold several; each records the models it locked at its start.
 */
export interface PipelineRun {
	index: number;
	startedAt: string;
	/** The locked models, null when the run's picks did not resolve and it ran unlocked. */
	orchestrator: string | null;
	subagent: string | null;
	/** Models resolved from the live settings instead of the run's locked picks. */
	lockMisses: number;
}

/** A stored call: `run` is the index of the pipeline run that made it, `lockMiss` marks one made without locked models. */
export type RunTokenCall = TokenCall & { run?: number; lockMiss?: true };

/** A review's stored metrics with its pipeline runs; rows older than recording runs have none. */
export type StoredMetrics = Omit<NonNullable<ReturnType<typeof reviewMetrics.get>>, 'calls'> & {
	runs?: PipelineRun[];
	calls: RunTokenCall[];
};

/** Who the running code spends tokens for; `run` is set for pipeline work only. */
interface MetricsOwner {
	reviewId: string;
	scope: TokenScope;
	run?: number;
}

/** Async context covers nested agent loops and retries without threading review IDs through model config. */
const context = new AsyncLocalStorage<MetricsOwner>();

function storedMetrics(reviewId: string): StoredMetrics | undefined {
	return reviewMetrics.get(reviewId) as StoredMetrics | undefined;
}

/** Opens a run segment on the review's metrics with the models locked for it, and returns its index. */
function openRun(metrics: StoredMetrics): number {
	const picks = lockedModels();
	const runs = metrics.runs ?? [];
	const index = runs.length;

	const run: PipelineRun = {
		index,
		startedAt: new Date().toISOString(),
		orchestrator: picks?.orchestrator.model ?? null,
		subagent: picks?.subagent.model ?? null,
		lockMisses: 0
	};

	const next: StoredMetrics = { ...metrics, runs: [...runs, run] };

	reviewMetrics.set(next);

	return index;
}

/** Counts calls under `run` toward `reviewId`; a pipeline run also opens its own run segment. */
export function withReviewMetrics<T>(reviewId: string, scope: TokenScope, run: () => T): T {
	if (!db.reviews.get(reviewId)) return context.run({ reviewId, scope }, run);

	const stored = storedMetrics(reviewId);

	const metrics = stored ?? {
		id: reviewId,
		startedAt: new Date().toISOString(),
		pipelineTracked: scope === 'pipeline',
		calls: []
	};

	if (scope === 'pipeline') return context.run({ reviewId, scope, run: openRun(metrics) }, run);
	if (!stored) reviewMetrics.set(metrics);

	return context.run({ reviewId, scope }, run);
}

/** The model calls one piece of work made and the output tokens they spent; tokens stay null until a provider reports a count. */
export interface ModelTally {
	calls: number;
	outputTokens: number | null;
}

const tallies = new AsyncLocalStorage<ModelTally>();

/** Run `run` with every model call it starts, however nested, counted in `tally` with its output tokens. */
export function withModelTally<T>(tally: ModelTally, run: () => T): T {
	return tallies.run(tally, run);
}

/** The pipeline run the running code belongs to, with its review's stored metrics. */
function currentRun(): { owner: MetricsOwner; metrics: StoredMetrics; run: PipelineRun } | null {
	const owner = context.getStore();

	if (owner?.run === undefined) return null;

	const metrics = storedMetrics(owner.reviewId);
	const run = metrics?.runs?.[owner.run];

	return metrics && run ? { owner, metrics, run } : null;
}

/** Warns the first time a pipeline run goes without locked models, so a run that mixes models says so in the log. */
function warnLockMiss(owner: MetricsOwner, run: PipelineRun): void {
	if (run.lockMisses === 1)
		console.warn(`[metrics] review ${owner.reviewId} run ${run.index} used a model it did not lock`);
}

/** Records that code running inside a pipeline resolved a model from the live settings. Outside a pipeline it does nothing. */
export function recordLockMiss(): void {
	const current = currentRun();

	if (!current) return;

	current.run.lockMisses++;
	reviewMetrics.set(current.metrics);
	warnLockMiss(current.owner, current.run);
}

export function trackTokenCall(model: string, provider: TokenCall['provider']) {
	const owner = context.getStore();
	const tally = tallies.getStore();
	const pipeline = owner?.run !== undefined;

	if (tally) tally.calls++;

	const call: RunTokenCall = {
		id: crypto.randomUUID(),
		model,
		provider,
		scope: owner?.scope ?? 'pipeline',
		status: 'pending',
		usage: emptyTokenUsage(),
		...(pipeline && { run: owner.run }),
		...(pipeline && !lockedModels() && { lockMiss: true as const })
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
		apiKeySource: (source: string) => {
			call.apiKeySource = source;
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
