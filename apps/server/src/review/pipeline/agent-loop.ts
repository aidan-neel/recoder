import { CapacityError, LlmError, type ChatMessage } from '../../models/llm.js';
import { streamedMessage } from '../../models/response-text.js';
import { extractJsonValue } from '../../models/json-extract.js';
import { parseActions, formatToolResults } from '../../evidence/evidence.js';
import { REVIEW_POLICY } from '../session/review-policy.js';
import { isAuthFailure } from './planner.js';
import { isUsageLimit, modelFailure } from '../../models/model-failure.js';
import { chatStyle, RETRIEVAL_EXAMPLES } from './prompts.js';
import { reviewNow, reviewPausePoint } from '../session/review-control.js';
import { ModelBlockedError, ReviewAbortedError, throwIfAborted } from './agent-loop/budget.js';
import type { JsonAgentOptions } from './agent-loop/options.js';
import { streamTurn, type TurnResult } from './agent-loop/stream-turn.js';

export { ModelBlockedError, ModelBudget, ReviewAbortedError, canLaunchInvestigation } from './agent-loop/budget.js';
export { isLooping } from './agent-loop/stream-turn.js';

const REPLY_RULES =
	'\nIn every JSON response, put "message" first: a concise, reader-facing Markdown explanation of your current investigation or conclusion. Then include EITHER "actions" (when you still want to read or run something) OR the final result fields (only once you are done). Never send final result fields while you still intend to look at more code: that ends your work. Describe actual evidence and decisions; do not narrate JSON formatting or budget compliance. This text is shown live to the developer. ';

const FINAL_TURN =
	'This is your final turn. Return the required compact result JSON using available evidence, with the reader-facing "message" first. Do not request retrieval. Omit other optional fields when unnecessary.';

/**
 * When this agent must stop and when its next turn must be the final one.
 * Consolidation time is reserved throughout an investigation, not merely when dispatching it.
 */
function agentDeadlines<T>(opts: JsonAgentOptions<T>): { startedAt: number; deadlineAt: number; finalTurnAt: number } {
	const startedAt = reviewNow();

	const deadlineAt = Math.min(
		opts.deadlineAt - (opts.consumeReserve ? 0 : REVIEW_POLICY.reserveMsForConsolidation),
		opts.timeLimit ? startedAt + opts.timeLimit.maxWallMs : Infinity
	);

	const finalTurnAt = opts.timeLimit ? startedAt + opts.timeLimit.finalTurnAfterMs : Infinity;

	return { startedAt, deadlineAt, finalTurnAt };
}

/** The note shown under a reply that was cut off and is being retried. */
function cutOffNote(err: unknown, overthought: boolean, dropped: boolean, truncated: boolean): string | undefined {
	if (overthought) return 'It thought for too long without answering, so it was asked to answer now.';
	if (dropped) return `The connection to the model dropped (${(err as Error).message}). Trying again.`;
	if (truncated) return 'The reply hit the output limit. Asking for a shorter one.';

	return undefined;
}

/**
 * Decides what follows a failed model call: a repair prompt to retry with,
 * or the error to stop on. Throws when the whole review must stop, because
 * the model is blocked or the review was aborted.
 */
function afterFailedCall<T>(
	opts: JsonAgentOptions<T>,
	failure: Extract<TurnResult, { kind: 'failed' }>,
	canRepair: boolean,
	shapes: string
): { retry?: string; error: string } {
	const { err, overthought } = failure;
	const retrying = !opts.signal.aborted && canRepair;
	const dropped = !overthought && err instanceof LlmError && /timed out|stalled|socket|connection/i.test(err.message);
	const truncated = err instanceof Error && /output truncated/i.test(err.message);

	failure.settle(retrying ? cutOffNote(err, overthought, dropped, truncated) : undefined);

	if (isAuthFailure(err) || isUsageLimit(err, opts.config))
		throw new ModelBlockedError(modelFailure(err, opts.config, 'The model rejected the request.'));

	if (err instanceof CapacityError) return { error: err.message };

	if (retrying && (overthought || dropped)) {
		return {
			retry: `You spent too long thinking without replying. Stop deliberating and reply now with JSON only: request the evidence you need, or give your final result with what you already know.\n\n${shapes}`,
			error: overthought ? 'reasoning ran too long without an answer' : (err as Error).message
		};
	}

	if (opts.signal.aborted || (!overthought && err instanceof LlmError && /cancel/i.test(err.message))) {
		throw new ReviewAbortedError('review aborted');
	}

	const error = err instanceof Error ? err.message : String(err);

	opts.onLog?.(`${opts.label} failed: ${error}`);

	if (/output truncated/i.test(error) && canRepair) {
		return {
			retry:
				'Your response exceeded the output limit. Return compact valid JSON. Keep explanations short, omit optional fields and repeated gaps, and prioritize the most important findings.',
			error
		};
	}

	return { error };
}

/** `{"message": "…"}` and nothing else: narration without a request or a result. */
function isCommentaryOnly(parsed: unknown): boolean {
	if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return false;

	const entries = Object.entries(parsed as Record<string, unknown>);

	return (
		entries.some(([key, value]) => key === 'message' && typeof value === 'string') &&
		entries.every(([key, value]) => key === 'message' || value == null || (Array.isArray(value) && value.length === 0))
	);
}

/**
 * The repair prompt for a reply that was neither a request nor a valid result.
 * Small models often send only the narration and close the object; saying
 * exactly that works, where listing the final schema's missing fields does not.
 */
function invalidReplyPrompt(parsed: unknown, problems: string, lastTurn: boolean, shapes: string): string {
	if (isCommentaryOnly(parsed))
		return `Your reply only had "message", so nothing was read: it had no "actions" list. Reply again with your "message" AND the "actions" that read what you described.${lastTurn ? '' : ' Only once you are done, send the final result instead.'}\n\n${shapes}`;

	return `Your JSON was neither a retrieval request nor a valid final result. Problems: ${problems}.\n\n${shapes}`;
}

let agentSeq = 0;

/** A review-unique agent id, which keeps an agent's scratch files and runs its own. */
export function newAgentId(): string {
	return `agent_${++agentSeq}`;
}

export async function runJsonAgent<T>(opts: JsonAgentOptions<T>): Promise<{ value: T | null; error?: string }> {
	const agentId = opts.agentId ?? newAgentId();
	const { startedAt, deadlineAt, finalTurnAt } = agentDeadlines(opts);
	const spendOpts = { consumeReserve: opts.consumeReserve };

	const messages: ChatMessage[] = [
		{ role: 'system', content: opts.system + REPLY_RULES + chatStyle(opts.config.model) },
		{ role: 'user', content: opts.user }
	];

	let repaired = 0;
	let retrievals = 0;
	let runs = 0;
	let finalNudged = false;

	/** The previous round when every action in it failed: asking again won't go differently, so the next turn is the last. */
	let failedRound = '';
	let stuck = false;
	let lastError = 'no model output';
	const shapes = `${opts.actionExamples ?? RETRIEVAL_EXAMPLES}\nTo finish, reply with ONLY the final JSON object${opts.finalExample ? `, for example:\n${opts.finalExample}` : '.'}\nNo prose outside the JSON, no code fences.`;

	/**
	 * The evidence round in progress. Schema repairs cost model calls but not a
	 * round; each successful retrieval advances it, and the final round is reserved for the result.
	 */
	let turn = 1;
	const canRepair = () => repaired < REVIEW_POLICY.schemaRepairAttempts && turn <= opts.maxTurns;

	for (let call = 1; call <= opts.maxTurns + REVIEW_POLICY.schemaRepairAttempts; call++) {
		throwIfAborted(opts.signal);
		await reviewPausePoint(opts.signal);
		throwIfAborted(opts.signal);

		if (reviewNow() >= deadlineAt) {
			const ownLimit = opts.timeLimit && deadlineAt === startedAt + opts.timeLimit.maxWallMs;

			return {
				value: null,
				error: ownLimit
					? `Ran out of time: no answer within ${Math.round(opts.timeLimit!.maxWallMs / 60_000)} minutes`
					: 'Investigation deadline reached; remaining time reserved for consolidation'
			};
		}

		if (!opts.budget.canSpend(1, spendOpts)) {
			return { value: null, error: 'model-call budget exhausted' };
		}

		const lastTurn =
			stuck || turn >= opts.maxTurns || !opts.budget.canSpend(2, spendOpts) || reviewNow() >= finalTurnAt;

		if (lastTurn && !messages.at(-1)?.content.startsWith('This is your final turn.'))
			messages.push({ role: 'user', content: FINAL_TURN });

		opts.budget.spend();
		opts.onLog?.(`${opts.label} model turn ${turn}/${opts.maxTurns} (${opts.config.model})`);

		const started = Date.now();
		const result = await streamTurn(opts, messages, turn, lastTurn, deadlineAt);

		if (result.kind === 'paused') {
			opts.budget.used = Math.max(0, opts.budget.used - 1);
			call--;
			continue;
		}

		if (result.kind === 'failed') {
			const step = afterFailedCall(opts, result, canRepair(), shapes);

			lastError = step.error;

			if (step.retry === undefined) return { value: null, error: lastError };

			repaired++;
			messages.push({ role: 'user', content: step.retry });
			continue;
		}

		const { output, responseId } = result;
		let parsed: unknown;

		try {
			parsed = extractJsonValue(output);
		} catch (err) {
			lastError = err instanceof Error ? err.message : 'invalid JSON';

			if (canRepair()) {
				repaired++;
				messages.push({ role: 'assistant', content: output });
				messages.push({ role: 'user', content: `Your previous reply was not valid JSON (${lastError}).\n\n${shapes}` });
				continue;
			}

			return { value: null, error: lastError };
		}

		if (
			!streamedMessage(output) &&
			parsed &&
			typeof parsed === 'object' &&
			'message' in parsed &&
			typeof parsed.message === 'string'
		) {
			opts.onMessage?.({ id: responseId, text: parsed.message, status: 'done' });
		}

		const actions = parseActions(parsed);

		if (actions && !lastTurn && opts.budget.canSpend(1, spendOpts) && reviewNow() < deadlineAt) {
			opts.onProgress?.('retrieval', Date.now() - started, `Reading repository evidence for ${opts.label}`);

			const results = await opts.evidence.executeRound(
				actions,
				opts.signal,
				opts.onTool,
				REVIEW_POLICY.maxRetrievalsPerTurn,
				agentId
			);

			retrievals++;
			runs += actions.filter((action) => action.action === 'run').length;

			for (const result of results) {
				if (result.ok && result.path)
					opts.onLog?.(`Reading ${result.path}${result.startLine ? `:${result.startLine}` : ''}`);
			}

			const round = results.length > 0 && results.every((result) => !result.ok) ? JSON.stringify(actions) : '';

			if (round && round === failedRound) {
				stuck = true;
				opts.onLog?.(`${opts.label} repeated a request that failed; asking for its answer`);
			}

			failedRound = round;
			messages.push({ role: 'assistant', content: output });

			messages.push({
				role: 'user',
				content:
					formatToolResults(results) +
					(stuck || turn + 1 >= opts.maxTurns
						? '\n\nThis is your final turn. Finish with the required JSON result. Do not request more retrieval.'
						: '\n\nContinue. Finish with the required JSON when you have enough evidence.')
			});

			turn++;
			continue;
		}

		const value = opts.parse(parsed);

		if (value) {
			/** One push-back, and only while a turn remains to act on it. */
			const nudge = !finalNudged && !lastTurn ? opts.checkFinal?.(value, { retrievals, runs }) : null;

			if (!nudge) return { value };

			finalNudged = true;
			opts.onLog?.(`${opts.label} finished early; asking it to investigate first`);
			messages.push({ role: 'assistant', content: output });
			messages.push({ role: 'user', content: `${nudge}\n\n${shapes}` });
			continue;
		}

		lastError = opts.validationError?.(parsed) ?? 'output did not match the required schema';

		if (canRepair() && !actions) {
			repaired++;
			messages.push({ role: 'assistant', content: output });
			messages.push({ role: 'user', content: invalidReplyPrompt(parsed, lastError, lastTurn, shapes) });

			lastError = isCommentaryOnly(parsed)
				? 'the model kept replying with only a message, without actions or a result'
				: lastError;

			continue;
		}

		if (actions)
			return {
				value: null,
				error: lastTurn
					? 'final turn requested retrieval instead of completing'
					: 'No model capacity or investigation time remained to inspect the requested evidence'
			};

		return { value: null, error: lastError };
	}

	return { value: null, error: lastError };
}
