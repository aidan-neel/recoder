import { AsyncLocalStorage } from 'node:async_hooks';
import {
	TOKEN_STAGES,
	aggregateTokenCalls,
	emptyTokenUsage,
	type ModelCallOutcome,
	type ModelCallRow,
	type QueueDelay,
	type ReasoningEffort,
	type ReviewMetrics,
	type TokenCall,
	type TokenScope,
	type TokenStage,
	type TokenBudget,
	type TokenUsage
} from '@recoder/shared';
import type { TopicTally } from '../review/guidelines/learned/votes';
import { db, modelCalls, reviewMetrics } from '../store';
import { metricWrites } from '../storage/persistence-queue';
import { providerErrorText } from './error-text';
import {
	CapacityError,
	isRateLimitError,
	LlmError,
	OutOfTimeError,
	TimedOutError,
	UsageLimitError
} from './llm/errors';
import { lockedModels } from './llm/locked-models';
import { withLlmLane } from './llm/lane';
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
	/** The locked verifier model; absent on rows stored before the verifier had its own pick. */
	verifier?: string | null;
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

/** Who the running code spends tokens for: a review or a repository chat; `run` is set for pipeline work only. */
interface MetricsOwner {
	/** The review's or chat's id, which keys its metrics row. */
	ownerId: string;
	scope: TokenScope;
	/** What `ownerId` names; `other` when it is neither a review nor a chat. */
	kind: ModelCallRow['kind'];
	/** The account that started the work (`startedBy`); null for `other` calls and owners stored without one. */
	person: string | null;
	run?: number;
}

/** Async context covers nested agent loops and retries without threading review IDs through model config. */
const context = new AsyncLocalStorage<MetricsOwner>();

function queueFor(ownerId: string) {
	return metricWrites.for(ownerId);
}

async function flushReviewMetrics(ownerId: string): Promise<void> {
	await metricWrites.drain(ownerId);
}

/** The review or repository chat `ownerId` names and the account that started it; undefined when it is neither. */
async function usageOwner(ownerId: string): Promise<Pick<MetricsOwner, 'kind' | 'person'> | undefined> {
	const review = await db.reviews.get(ownerId);

	if (review) return { kind: 'review', person: review.startedBy ?? null };

	const chat = await db.repoChats.get(ownerId);

	if (chat) return { kind: 'chat', person: chat.startedBy ?? null };

	return undefined;
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
		verifier: picks?.verifier.model ?? null,
		lockMisses: 0,
		...(worker && { worker })
	};

	metrics.runs = [...runs, run];

	return index;
}

/**
 * Counts calls under `run` toward the review or repository chat `ownerId`; a pipeline run also opens its own run
 * segment. The calls wait for model slots in the owner's own lane, so the limiter takes turns between them.
 */
export async function withUsageMetrics<T>(ownerId: string, scope: TokenScope, run: () => T): Promise<Awaited<T>> {
	const found = await usageOwner(ownerId);
	const owner: MetricsOwner = { ownerId, scope, kind: found?.kind ?? 'other', person: found?.person ?? null };

	if (found) {
		await flushReviewMetrics(ownerId);

		await reviewMetrics.update(ownerId, (stored) => {
			const metrics: StoredMetrics = stored ?? {
				id: ownerId,
				startedAt: new Date().toISOString(),
				pipelineTracked: scope === 'pipeline',
				calls: []
			};

			if (scope === 'pipeline') owner.run = openRun(metrics);

			return metrics;
		});
	}

	try {
		return await context.run(owner, () => withLlmLane({ id: ownerId, recordWait: recordQueueDelay }, run));
	} finally {
		await flushReviewMetrics(ownerId);
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

	queueFor(owner.ownerId).push(async () => {
		await reviewMetrics.update(owner.ownerId, (stored) => {
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
			console.warn(`[metrics] review ${owner.ownerId} run ${run.index} used a model it did not lock`);
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

/** Queue bucket for calls with no owning review or chat, so their rows drain together. */
const UNOWNED_CALLS = 'model-calls';

/** The error ended the call because its caller stopped it, not because the model or the transport did. */
function isCancellation(err: unknown): boolean {
	if (!(err instanceof Error)) return false;
	if (err.name === 'AbortError' || err.name === 'ReviewAbortedError') return true;

	return err instanceof LlmError && err.status === 0 && /cancelled/i.test(err.message);
}

/** A one-word classification of a failed call's error, so the usage report can group them. */
function errorKindOf(err: unknown): string {
	if (err instanceof UsageLimitError) return 'usage-limit';
	if (err instanceof CapacityError) return 'capacity';
	if (err instanceof TimedOutError) return 'timeout';
	if (err instanceof OutOfTimeError) return 'deadline';
	if (err instanceof Error && err.name === 'TimeoutError') return 'timeout';

	if (err instanceof LlmError) {
		if (isRateLimitError(err)) return 'rate-limit';
		if (err.status >= 500) return 'provider';
		if (err.status >= 400) return 'request';
	}

	return 'error';
}

export function trackTokenCall(model: string, provider: TokenCall['provider'], effort?: ReasoningEffort) {
	const owner = context.getStore();
	const tally = tallies.getStore();
	const stage = stages.getStore();
	const pipeline = owner?.run !== undefined;
	const worker = currentLease()?.ownerId;

	if (tally) tally.calls++;

	const at = new Date().toISOString();

	const call: RunTokenCall = {
		id: crypto.randomUUID(),
		at,
		model,
		provider,
		scope: owner?.scope ?? 'pipeline',
		...(stage && { stage }),
		status: 'pending',
		usage: emptyTokenUsage(),
		...(pipeline && { run: owner.run }),
		...(pipeline && !lockedModels() && { lockMiss: true as const })
	};

	const queueId = owner?.ownerId ?? UNOWNED_CALLS;
	const startedMs = Date.now();
	let outcome: ModelCallOutcome | undefined;
	let errorKind: string | undefined;
	let durationMs: number | undefined;

	/**
	 * The call as a `model_calls` row once it settles, and nothing before: an outcome that is still
	 * open is not history yet. Usage arriving after `complete`/`fail` still lands, as the row is
	 * rewritten on every save while the call keeps reporting.
	 */
	const telemetry = (): ModelCallRow | undefined => {
		if (outcome === undefined) return undefined;

		return {
			id: call.id,
			at,
			person: owner?.person ?? null,
			kind: owner?.kind ?? 'other',
			ownerId: owner?.kind === 'review' || owner?.kind === 'chat' ? owner.ownerId : null,
			...(call.stage && { stage: call.stage }),
			provider: call.provider,
			model: call.model,
			...(effort && { effort }),
			usage: call.usage,
			...(durationMs !== undefined && { durationMs }),
			outcome,
			...(errorKind && { errorKind }),
			...(worker && { worker })
		};
	};

	const save = () => {
		const saved = structuredClone(call);
		const row = telemetry();

		queueFor(queueId).push(async () => {
			if (owner) {
				await reviewMetrics.update(owner.ownerId, (metrics) => {
					if (!metrics) return metrics;

					const index = metrics.calls.findIndex((item) => item.id === saved.id);

					if (index < 0) metrics.calls.push(saved);
					else metrics.calls[index] = saved;

					return metrics;
				});
			}

			if (row) await modelCalls.set(row);
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
			outcome = 'ok';
			durationMs = Date.now() - startedMs;
			save();
		},
		/** Records the call as failed with the provider's error, without any of `secrets` the call was given. */
		fail: (err: unknown, secrets: readonly (string | undefined)[] = []) => {
			call.status = 'failed';
			call.error = providerErrorText(err, secrets);
			durationMs = Date.now() - startedMs;

			if (isCancellation(err)) outcome = 'cancelled';
			else {
				outcome = 'failed';
				errorKind = errorKindOf(err);
			}

			save();
		},
		/** Waits until this call's queued records have reached durable storage. */
		flush: async () => {
			await metricWrites.drain(queueId);
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
