import { CapacityError, ChatConversation, LlmError, type ChatMessage } from '../../models/llm.js';
import { withTokenStage } from '../../models/metrics.js';
import { streamedMessage } from '../../models/response-text.js';
import { extractJsonValue } from '../../models/json-extract.js';
import { parseActions, formatToolResults } from '../../evidence/evidence.js';
import { REVIEW_POLICY } from '../session/review-policy.js';
import { isAuthFailure, isUsageLimit, modelFailure } from '../../models/model-failure.js';
import { CHAT_STYLE, EXEC_EXAMPLES, RETRIEVAL_EXAMPLES } from './prompts.js';
import { reviewNow, reviewPausePoint } from '../session/review-control.js';
import { ModelBlockedError, ReviewAbortedError, throwIfAborted } from './agent-loop/budget.js';
import { DELEGATE_SHAPE, commandsRun, executeTurn } from './agent-loop/delegation.js';
import { agentDeadlines, deadlineError, newAgentId, toolTurns } from './agent-loop/limits.js';
import { runOpenCodeAgent } from './agent-loop/opencode-engine.js';
import type { JsonAgentOptions } from './agent-loop/options.js';
import { streamTurn, type TurnResult } from './agent-loop/stream-turn.js';

export { ModelBlockedError, ModelBudget, ReviewAbortedError, canLaunchInvestigation } from './agent-loop/budget.js';
export { newAgentId } from './agent-loop/limits.js';
export { isLooping } from './agent-loop/stream-turn.js';

const REPLY_RULES =
	'\nIn every JSON response, put "message" first: a concise, reader-facing Markdown explanation of your current investigation or conclusion. Then include EITHER "actions" (when you still want to read or run something) OR the final result fields (only once you are done). Never send final result fields while you still intend to look at more code: that ends your work. Describe actual evidence and decisions; do not narrate JSON formatting or budget compliance. This text is shown live to the developer. ';

/**
 * Heads the developer's discussion since the review started. It is added to
 * the transcript when it changes, never rewritten in place, so earlier turns
 * stay a stable prefix for the provider's cache.
 */
const DISCUSSION_NOTE = 'Developer conversations since the review started (consider these with the review evidence):';

const FINAL_TURN =
	'This is your final turn. Return the required compact result JSON using available evidence, with the reader-facing "message" first. Do not request retrieval. Omit other optional fields when unnecessary.';

/** Why a reply was cut off and asked again: a short line on the composer while the retry runs. */
function cutOffNote(overthought: boolean, dropped: boolean, truncated: boolean): string | undefined {
	if (overthought) return 'Thought too long. Asking for an answer now.';
	if (dropped) return 'Connection to the model dropped. Trying again.';
	if (truncated) return 'Reply hit the output limit. Asking for a shorter one.';

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

	failure.settle(retrying ? cutOffNote(overthought, dropped, truncated) : undefined);

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

/**
 * Run an agent to its answer. OpenCode runs the agent itself, calling
 * Recoder's tools as it goes. Every other provider is only a model: Recoder
 * runs the loop, asking for JSON action requests turn by turn. Those calls
 * share one conversation, so a transport that keeps a session reuses the
 * provider's prompt cache.
 */
export function runJsonAgent<T>(opts: JsonAgentOptions<T>): Promise<{ value: T | null; error?: string }> {
	return withTokenStage(opts.stage, async () => {
		if (opts.config.provider === 'opencode') return runOpenCodeAgent(opts);

		const conversation = new ChatConversation();

		try {
			return await runTurns(opts, conversation);
		} finally {
			await conversation.close();
		}
	});
}

async function runTurns<T>(
	opts: JsonAgentOptions<T>,
	conversation: ChatConversation
): Promise<{ value: T | null; error?: string }> {
	const agentId = opts.agentId ?? newAgentId();
	const limits = agentDeadlines(opts);
	const { deadlineAt, finalTurnAt } = limits;
	const lastToolTurn = toolTurns(opts);
	const spendOpts = { consumeReserve: opts.consumeReserve };

	const messages: ChatMessage[] = [
		{ role: 'system', content: opts.system + REPLY_RULES + CHAT_STYLE },
		{ role: 'user', content: opts.user }
	];

	let repaired = 0;
	let retrievals = 0;
	let runs = 0;

	/** Nudges already sent: each distinct one goes out once. */
	const nudged = new Set<string>();

	/** The previous round when every action in it failed: asking again won't go differently, so the next turn is the last. */
	let failedRound = '';
	let stuck = false;
	let lastError = 'no model output';
	let sentDiscussion = '';
	const shapes = `${opts.exec ? EXEC_EXAMPLES : RETRIEVAL_EXAMPLES}${opts.delegate ? DELEGATE_SHAPE : ''}\nTo finish, reply with ONLY the final JSON object${opts.finalExample ? `, for example:\n${opts.finalExample}` : '.'}\nNo prose outside the JSON, no code fences.`;

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

		if (reviewNow() >= deadlineAt) return { value: null, error: deadlineError(opts, limits) };

		if (!opts.budget.canSpend(1, spendOpts)) {
			return { value: null, error: 'model-call budget exhausted' };
		}

		const lastTurn = stuck || turn > lastToolTurn || !opts.budget.canSpend(2, spendOpts) || reviewNow() >= finalTurnAt;

		const discussion = opts.getDiscussion?.() ?? '';

		if (discussion && discussion !== sentDiscussion) {
			messages.push({ role: 'user', content: `${DISCUSSION_NOTE}\n${discussion}` });
			sentDiscussion = discussion;
		}

		if (lastTurn && !messages.at(-1)?.content.startsWith('This is your final turn.'))
			messages.push({ role: 'user', content: FINAL_TURN });

		opts.budget.spend();
		opts.onLog?.(`${opts.label} model turn ${turn}/${opts.maxTurns} (${opts.config.model})`);

		const started = Date.now();
		const result = await streamTurn(opts, messages, conversation, turn, lastTurn, deadlineAt);

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

			const results = await executeTurn(opts, actions, agentId);

			retrievals++;
			runs += commandsRun(actions, results);

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
					(stuck || turn + 1 > lastToolTurn
						? '\n\nThis is your final turn. Finish with the required JSON result. Do not request more retrieval.'
						: '\n\nContinue. Finish with the required JSON when you have enough evidence.')
			});

			turn++;
			continue;
		}

		const value = opts.parse(parsed);

		if (value) {
			/** Each push-back goes out once, and only while a turn remains to act on it. */
			const nudge = lastTurn ? null : opts.checkFinal?.(value, { retrievals, runs });

			if (!nudge || nudged.has(nudge)) return { value };

			nudged.add(nudge);
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

		/** Retrieval asked for on an answer turn that is not the last one is refused, and the next turn asks again. */
		if (actions && !stuck && turn > lastToolTurn && turn < opts.maxTurns) {
			messages.push({ role: 'assistant', content: output });
			messages.push({ role: 'user', content: FINAL_TURN });
			turn++;
			continue;
		}

		if (actions)
			return {
				value: null,
				error: lastTurn
					? 'final turn requested retrieval instead of completing'
					: 'No model capacity or investigation time remained to inspect the requested evidence'
			};

		const kept = opts.salvage?.(parsed);

		return kept ? { value: kept } : { value: null, error: lastError };
	}

	return { value: null, error: lastError };
}
