import { AsyncLocalStorage } from 'node:async_hooks';
import {
	TOKEN_STAGES,
	aggregateTokenCalls,
	emptyTokenUsage,
	type QueueDelay,
	type ReviewMetrics,
	type TokenCall,
	type TokenScope,
	type TokenStage,
	type TokenBudget,
	type TokenUsage
} from '@recoder/shared';
import type { TopicTally } from '../review/guidelines/learned/votes';
import { db, reviewMetrics } from '../store';
import { metricWrites } from '../storage/persistence-queue';
import { providerErrorText } from './error-text';
import { lockedModels } from './llm/locked-models';
import { withLlmLane } from './llm/limiter';
import { currentLease } from '../review/runtime/ownership';

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
	/** How long the run's model requests waited for slots; unset until its first request. */
	queueDelay?: QueueDelay;
	/** The review worker that ran it, its lease owner id; unset without shared storage. */
	worker?: string;
	/** The repository history the run received, so an evaluation can audit or replay it; unset on runs older than recording it. */
	history?: RunHistory;
}

/** One history source the brief was given, without its text. */
export interface HistorySource {
	/** `pr-history`, `commit`, `past-review` or `related-review`. */
	kind: string;
	/** `pr:#31`, `commit:abc1234`, `merge:abc1234`, `review:#31`, or `history:unavailable` for commits nothing explains. */
	ref: string;
	/** The commit the source was read from. */
	revision?: string;
	/** The commits that landed together, `parent..tip`. */
	range?: string;
	/** True when a retrieved PR record backs it, false when only a commit or merge message names it. */
	recorded?: boolean;
}

/**
 * Which of the repository's history a pipeline run received. A part is absent
 * when the run never read it, and empty when it read it and found nothing.
 */
export interface RunHistory {
	/** Earlier PRs, commits, merges and reviews of the changed code the brief was given. */
	sources?: HistorySource[];
	/** The fingerprints of the findings people dismissed in this repository, newest first. */
	dismissals?: string[];
	/** People's votes on each topic's findings, which rank the rules and quiet findings. */
	topics?: Record<string, TopicTally>;
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
	const worker = currentLease()?.ownerId;
	const runs = metrics.runs ?? [];
	const index = runs.length;

	const run: PipelineRun = {
		index,
		startedAt: new Date().toISOString(),
		orchestrator: picks?.orchestrator.model ?? null,
		subagent: picks?.subagent.model ?? null,
		lockMisses: 0,
		...(worker && { worker })
	};

	metrics.runs = [...runs, run];

	return index;
}

/**
 * Counts calls under `run` toward `reviewId`; a pipeline run also opens its own run segment. The calls wait for
 * model slots in the review's own lane, so the limiter takes turns between reviews.
 */
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
		return await context.run(owner, () => withLlmLane({ id: reviewId, recordWait: recordQueueDelay }, run));
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

/** Adds one model request's wait for a slot to the current pipeline run. */
function recordQueueDelay(waitedMs: number): void {
	updateCurrentRun((run) => {
		const delay = run.queueDelay ?? { requests: 0, totalMs: 0, maxMs: 0 };

		run.queueDelay = {
			requests: delay.requests + 1,
			totalMs: delay.totalMs + waitedMs,
			maxMs: Math.max(delay.maxMs, waitedMs)
		};
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

/** Adds what the running pipeline run read of the repository's history to its record. */
export function recordHistory(history: RunHistory): void {
	updateCurrentRun((run) => {
		run.history = { ...run.history, ...history };
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
		complete: () => {
			call.status = 'completed';
			save();
		},
		/** Records the call as failed with the provider's error, without any of `secrets` the call was given. */
		fail: (err: unknown, secrets: readonly (string | undefined)[] = []) => {
			call.status = 'failed';
			call.error = providerErrorText(err, secrets);
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
export function normalizeTokenUsage(raw: unknown, provider: TokenCall['provider']): TokenUsage {
	const count = (n: unknown): number | null => (typeof n === 'number' && Number.isSafeInteger(n) && n >= 0 ? n : null);
	const codex = provider === 'codex';

	const read = (codexKey: string, openAiKey: string, alias?: string) =>
		count(field(raw, codex ? codexKey : openAiKey)) ?? (codex || !alias ? null : count(field(raw, alias)));

	const promptDetails = field(raw, 'prompt_tokens_details');
	const inputTokens = read('inputTokens', 'prompt_tokens', 'input_tokens');
	const outputTokens = read('outputTokens', 'completion_tokens', 'output_tokens');

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
		queueDelay: stored.runs?.at(-1)?.queueDelay,
		worker: stored.runs?.at(-1)?.worker,
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
