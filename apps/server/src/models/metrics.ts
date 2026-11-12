import { AsyncLocalStorage } from 'node:async_hooks';
import {
	TOKEN_STAGES,
	aggregateTokenCalls,
	emptyTokenUsage,
	type ReviewMetrics,
	type TokenCall,
	type TokenScope,
	type TokenStage,
	type TokenBudget,
	type TokenUsage
} from '@recoder/shared';
import { db, reviewMetrics } from '../store';
import { metricWrites } from '../storage/persistence-queue';
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
	/** The token budget the run's limits came from; unset on runs older than budgets and on runs that stopped before the harness. */
	tokenBudget?: TokenBudget;
}

/** A stored call: `run` is the index of the pipeline run that made it, `lockMiss` marks one made without locked models. */
export type RunTokenCall = TokenCall & { run?: number; lockMiss?: true };

/** A review's stored metrics with its pipeline runs; rows older than recording runs have none. */
export type StoredMetrics = NonNullable<Awaited<ReturnType<typeof reviewMetrics.get>>>;

/** Who the running code spends tokens for; `run` is set for pipeline work only. */
interface MetricsOwner {
	reviewId: string;
	scope: TokenScope;
	run?: number;
}

/** Async context covers nested agent loops and retries without threading review IDs through model config. */
const context = new AsyncLocalStorage<MetricsOwner>();

function queueFor(reviewId: string) {
	return metricWrites.for(reviewId);
}

async function flushReviewMetrics(reviewId: string): Promise<void> {
	await metricWrites.drain(reviewId);
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

	metrics.runs = [...runs, run];

	return index;
}

/** Counts calls under `run` toward `reviewId`; a pipeline run also opens its own run segment. */
export async function withReviewMetrics<T>(reviewId: string, scope: TokenScope, run: () => T): Promise<Awaited<T>> {
	const owner: MetricsOwner = { reviewId, scope };

	if (await db.reviews.get(reviewId)) {
		await flushReviewMetrics(reviewId);

		await reviewMetrics.update(reviewId, (stored) => {
			const metrics: StoredMetrics = stored ?? {
				id: reviewId,
				startedAt: new Date().toISOString(),
				pipelineTracked: scope === 'pipeline',
				calls: []
			};

			if (scope === 'pipeline') owner.run = openRun(metrics);

			return metrics;
		});
	}

	try {
		return await context.run(owner, run);
	} finally {
		await flushReviewMetrics(reviewId);
	}
}

const stages = new AsyncLocalStorage<TokenStage>();

/** Tags every model call `run` starts, however nested, with the kind of agent making it; an inner stage wins. */
export function withTokenStage<T>(stage: TokenStage, run: () => T): T {
	return stages.run(stage, run);
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
function updateCurrentRun(mutate: (run: PipelineRun, owner: MetricsOwner) => void): void {
	const owner = context.getStore();

	if (owner?.run === undefined) return;

	const index = owner.run;

	queueFor(owner.reviewId).push(async () => {
		await reviewMetrics.update(owner.reviewId, (stored) => {
			const metrics = stored;
			const run = metrics?.runs?.[index];

			if (run) mutate(run, owner);

			return metrics;
		});
	});
}

export function recordLockMiss(): void {
	updateCurrentRun((run, owner) => {
		run.lockMisses++;
		if (run.lockMisses === 1)
			console.warn(`[metrics] review ${owner.reviewId} run ${run.index} used a model it did not lock`);
	});
}

export function recordTokenBudget(tokenBudget: TokenBudget): void {
	updateCurrentRun((run) => {
		run.tokenBudget = tokenBudget;
	});
}

export function trackTokenCall(model: string, provider: TokenCall['provider']) {
	const owner = context.getStore();
	const tally = tallies.getStore();
	const stage = stages.getStore();
	const pipeline = owner?.run !== undefined;

	if (tally) tally.calls++;

	const call: RunTokenCall = {
		id: crypto.randomUUID(),
		model,
		provider,
		scope: owner?.scope ?? 'pipeline',
		...(stage && { stage }),
		status: 'pending',
		usage: emptyTokenUsage(),
		...(pipeline && { run: owner.run }),
		...(pipeline && !lockedModels() && { lockMiss: true as const })
	};

	const save = () => {
		if (!owner) return;

		const saved = structuredClone(call);

		queueFor(owner.reviewId).push(async () => {
			await reviewMetrics.update(owner.reviewId, (metrics) => {
				if (!metrics) return metrics;

				const index = metrics.calls.findIndex((item) => item.id === saved.id);

				if (index < 0) metrics.calls.push(saved);
				else metrics.calls[index] = saved;

				return metrics;
			});
		});
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

/**
 * Accept numbers, never coerce null, strings, negative values, or invalid counts to zero. Some
 * OpenAI-compatible gateways name the two main counts `input_tokens` and `output_tokens`, so those are read
 * when the chat-completions names are absent.
 */
export function normalizeTokenUsage(raw: unknown): TokenUsage {
	const count = (n: unknown): number | null => (typeof n === 'number' && Number.isSafeInteger(n) && n >= 0 ? n : null);
	const read = (key: string, alias?: string) => count(field(raw, key)) ?? (alias ? count(field(raw, alias)) : null);
	const promptDetails = field(raw, 'prompt_tokens_details');
	const inputTokens = read('prompt_tokens', 'input_tokens');
	const outputTokens = read('completion_tokens', 'output_tokens');

	return {
		inputTokens,
		outputTokens,
		totalTokens:
			read('total_tokens') ?? (inputTokens !== null && outputTokens !== null ? inputTokens + outputTokens : null),
		cachedInputTokens: count(field(promptDetails, 'cached_tokens')),
		cacheWriteInputTokens: count(field(promptDetails, 'cache_write_tokens')),
		reasoningOutputTokens: count(field(field(raw, 'completion_tokens_details'), 'reasoning_tokens'))
	};
}

/** Pipeline calls summed by stage, in `TOKEN_STAGES` order; a call without a stage counts as `other`. */
function stageAggregates(calls: TokenCall[]): ReviewMetrics['stages'] {
	return TOKEN_STAGES.map((stage) => ({
		stage,
		...aggregateTokenCalls(calls.filter((call) => (call.stage ?? 'other') === stage))
	})).filter((aggregate) => aggregate.calls > 0);
}

export async function getReviewMetrics(reviewId: string): Promise<ReviewMetrics | null> {
	await flushReviewMetrics(reviewId);

	const stored = await reviewMetrics.get(reviewId);

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
		tokenBudget: stored.runs?.at(-1)?.tokenBudget,
		total: aggregateTokenCalls(stored.calls),
		models: [...models.values()].map((calls) => ({
			model: calls[0]!.model,
			provider: calls[0]!.provider,
			...aggregateTokenCalls(calls)
		})),
		scopes: (['pipeline', 'discussion', 'fix'] as const).map((scope) => ({
			scope,
			...aggregateTokenCalls(stored.calls.filter((call) => call.scope === scope))
		})),
		stages: stageAggregates(stored.calls.filter((call) => call.scope === 'pipeline'))
	};
}
