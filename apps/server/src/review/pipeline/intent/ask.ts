import type { z } from 'zod';
import type { ModelConfig } from '../../../models/models.js';
import { readCache, writeCache } from '../../../util/json-cache.js';
import { reviewNow } from '../../session/review-control.js';
import { ModelBlockedError, ReviewAbortedError, runJsonAgent } from '../agent-loop.js';
import { orchestratorAgentOptions, type ReviewRun } from '../harness/context.js';
import type { BriefOmission } from './types.js';

/** Raised whenever a brief prompt or reply schema changes, so answers cached for an older one are never read. */
const INTENT_VERSION = 3;
const CACHE_NAMESPACE = 'intent';

const RETRY_NOTE =
	'\n\nA previous reply to this was a placeholder: a "..." summary or nothing in any list. Answer from the input above.';

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

function omissionOf(error: string): BriefOmission {
	if (/deadline|out of time/i.test(error)) return 'time';
	if (/budget/i.test(error)) return 'budget';

	return 'model';
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
 * Asks one part of the brief, reading the cache first. A placeholder is
 * asked for again once, while the review has time and calls left; a second
 * placeholder, an error, the deadline or the budget leaves the part
 * unanswered with the reason. Only a real answer is cached.
 */
export async function askBrief<T>(run: ReviewRun, cfg: ModelConfig, call: BriefCall<T>): Promise<BriefAnswer<T>> {
	const key = cacheKey(cfg, call);
	const cached = cachedAnswer(key, call);

	if (cached !== null) return { value: cached };

	for (const user of [call.user, call.user + RETRY_NOTE]) {
		const answer = cannotStart(run) ?? (await callOnce(run, cfg, call, user));

		if (!('value' in answer)) return answer;

		if (!call.placeholder(answer.value)) {
			writeCache(CACHE_NAMESPACE, key, answer.value);

			return answer;
		}

		run.events?.onLog?.(`intent ${call.label} answered with a placeholder`);
	}

	return { omitted: 'model', detail: 'the model answered with a placeholder twice' };
}
