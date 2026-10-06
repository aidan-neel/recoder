import type { z } from 'zod';
import { CapacityError } from '../../../models/llm.js';
import type { ModelConfig } from '../../../models/models.js';
import { readCache, writeCache } from '../../../util/json-cache.js';
import { reviewNow } from '../../session/review-control.js';
import { ModelBlockedError, ReviewAbortedError, runJsonAgent } from '../agent-loop.js';
import { orchestratorAgentOptions, type ReviewRun } from '../harness/context.js';
import type { BriefOmission } from './types.js';

/** Raised whenever a brief prompt or reply schema changes, so answers cached for an older one are never read. */
const INTENT_VERSION = 3;
const CACHE_NAMESPACE = 'intent';

/** A brief call may take this fraction of the review's remaining time, so the brief never spends what the reviewers need. */
const TIME_SHARE = 1 / 4;

/** What a call that waited out its time for a model slot comes back with; the model never saw it. */
const NO_SLOT = new CapacityError().message;

const RETRY_NOTE =
	'\n\nA previous reply to this was a placeholder: a "..." summary, nothing in any list, or only items about files or lines the input does not show. Answer from the input above.';

/** One call that writes part of the brief. */
export interface BriefCall<T> {
	/** `unit-2` or `context`, for the log. */
	label: string;
	system: string;
	user: string;
	schema: z.ZodType<T>;
	/** True for a reply that only fills in the template: `...`, nothing where the input has content, or every default. */
	placeholder: (value: T) => boolean;
}

/** A real answer, or why the call has none. */
export type BriefAnswer<T> = { value: T } | { omitted: BriefOmission; detail: string };

/**
 * Everything the answer depends on: the prompt version and text, the
 * effective model with its provider and effort, and the call's whole input.
 * A different prompt or model gives a different key, so an older answer is
 * never read back for it.
 */
function cacheKey(cfg: ModelConfig, call: Pick<BriefCall<unknown>, 'system' | 'user'>): string {
	return JSON.stringify({
		version: INTENT_VERSION,
		model: { provider: cfg.provider ?? null, source: cfg.source ?? null, id: cfg.model },
		effort: cfg.reasoningEffort ?? null,
		system: call.system,
		user: call.user
	});
}

/** The cached answer, only when it still parses and is not a placeholder. */
function cachedAnswer<T>(key: string, call: BriefCall<T>): T | null {
	const parsed = call.schema.safeParse(readCache<unknown>(CACHE_NAMESPACE, key));

	return parsed.success && !call.placeholder(parsed.data) ? parsed.data : null;
}

/** Why no call can start now, or null when one can. */
function cannotStart(run: ReviewRun): BriefAnswer<never> | null {
	if (reviewNow() >= run.deadlineAt) return { omitted: 'time', detail: 'the review deadline was reached' };
	if (!run.budget.canSpend(1)) return { omitted: 'budget', detail: 'the model-call budget was spent' };

	return null;
}

/** A call that found no model slot in time ran out of time, not into a model failure. */
function omissionOf(error: string): BriefOmission {
	if (error === NO_SLOT || /deadline|out of time/i.test(error)) return 'time';
	if (/budget/i.test(error)) return 'budget';

	return 'model';
}

/** This call's share of the time left before the review's deadline. */
function timeLimit(run: ReviewRun): { finalTurnAfterMs: number; maxWallMs: number } {
	const ms = Math.max(1, Math.floor((run.deadlineAt - reviewNow()) * TIME_SHARE));

	return { finalTurnAfterMs: ms, maxWallMs: ms };
}

/** One model call; its error comes back as the reason, apart from an abort or a blocked model, which stop every call. */
async function callOnce<T>(
	run: ReviewRun,
	cfg: ModelConfig,
	call: BriefCall<T>,
	user: string
): Promise<BriefAnswer<T>> {
	try {
		const result = await runJsonAgent({
			label: `intent ${call.label}`,
			...orchestratorAgentOptions(run, cfg),
			system: call.system,
			user,
			maxTurns: 1,
			deadlineAt: run.deadlineAt,
			timeLimit: timeLimit(run),
			parse: (raw) => {
				const parsed = call.schema.safeParse(raw);

				return parsed.success ? parsed.data : null;
			},
			onLog: (message) => run.events?.onLog?.(message)
		});

		if (result.value !== null) return { value: result.value };

		const error = result.error ?? 'no answer';

		return { omitted: omissionOf(error), detail: error };
	} catch (err) {
		if (err instanceof ReviewAbortedError || err instanceof ModelBlockedError) throw err;

		return { omitted: 'model', detail: err instanceof Error ? err.message : String(err) };
	}
}

/**
 * One call, made again once when it found no model slot in time: the model
 * never saw it, so a second wait behind the calls ahead of it can succeed.
 */
async function callWithSlot<T>(
	run: ReviewRun,
	cfg: ModelConfig,
	call: BriefCall<T>,
	user: string
): Promise<BriefAnswer<T>> {
	const answer = cannotStart(run) ?? (await callOnce(run, cfg, call, user));

	if (!('omitted' in answer) || answer.detail !== NO_SLOT) return answer;

	run.events?.onLog?.(`intent ${call.label} found no model slot in time; asking again`);

	return cannotStart(run) ?? (await callOnce(run, cfg, call, user));
}

/**
 * Asks one part of the brief, reading the cache first. A placeholder is
 * asked for again once, and a call that found no model slot in time is made
 * again once, while the review has time and calls left; a second placeholder,
 * an error, the deadline or the budget leaves the part unanswered with the
 * reason. Only a real answer is cached.
 */
export async function askBrief<T>(run: ReviewRun, cfg: ModelConfig, call: BriefCall<T>): Promise<BriefAnswer<T>> {
	const key = cacheKey(cfg, call);
	const cached = cachedAnswer(key, call);

	if (cached !== null) return { value: cached };

	for (const user of [call.user, call.user + RETRY_NOTE]) {
		const answer = await callWithSlot(run, cfg, call, user);

		if (!('value' in answer)) return answer;

		if (!call.placeholder(answer.value)) {
			writeCache(CACHE_NAMESPACE, key, answer.value);

			return answer;
		}

		run.events?.onLog?.(`intent ${call.label} answered with a placeholder`);
	}

	return { omitted: 'model', detail: 'the model answered with a placeholder twice' };
}
