import type { OutputRate, ReviewReasoningEntry } from '@recoder/shared';
import { streamChatCompletion, type ChatConversation, type ChatMessage } from '../../../models/llm.js';
import { sampling } from '../../../models/runtime-profiles.js';
import { streamedMessage } from '../../../models/response-text.js';
import { REVIEW_POLICY } from '../../session/review-policy.js';
import { currentReviewControl, reviewNow } from '../../session/review-control.js';
import type { JsonAgentOptions } from './options.js';

/** Reasoning can stream token by token and every emit carries the whole text to each subscriber, so emits are spaced out. */
const REASONING_EMIT_MS = 500;

const RESPONSE_EMIT_MS = 200;

export type TurnResult =
	| { kind: 'reply'; output: string; responseId: string }
	/** Paused mid-call: the caller gives the call back and redoes the turn after resume. */
	| { kind: 'paused' }
	/**
	 * The call failed. `overthought` means it was cut off for reasoning too long.
	 * `settle` closes the streamed message (with an optional note on why it was cut off) and the reasoning.
	 */
	| { kind: 'failed'; err: unknown; overthought: boolean; settle: (cutOff?: string) => void };

/** The tail of the reasoning keeps reappearing: the model is going in circles. */
export function isLooping(text: string): boolean {
	if (text.length < 4_000) return false;

	const tail = text.slice(-240);
	let count = 0;

	for (let at = text.indexOf(tail); at !== -1 && count < 3; at = text.indexOf(tail, at + 1)) count++;

	return count >= 3;
}

/**
 * One streamed model call for an agent turn, relaying its reasoning and
 * reply as they arrive. Runaway reasoning (too long, or looping) aborts the
 * call so a stuck model doesn't think until it times out. Pausing the review
 * aborts it too; the caller re-runs it on resume.
 */
export async function streamTurn<T>(
	opts: JsonAgentOptions<T>,
	messages: ChatMessage[],
	conversation: ChatConversation,
	turn: number,
	lastTurn: boolean,
	deadlineAt: number
): Promise<TurnResult> {
	const reasoningId = `reason_${opts.label.slice(0, 24)}_${turn}_${Math.random().toString(36).slice(2, 8)}`;
	const responseId = `message_${reasoningId}`;
	let reasoningText = '';
	let reasoningEmittedAt = 0;
	let response = '';
	let responseEmittedAt = 0;
	let overthought = false;
	let outputRate: OutputRate | undefined;

	/** ChatGPT sends a summary, not its reasoning: keep the timing, drop the text. */
	const flushReasoning = (status: ReviewReasoningEntry['status'] = 'streaming') => {
		if (!opts.onReasoning || !reasoningText) return;
		if (opts.config.provider === 'codex')
			opts.onReasoning({ id: reasoningId, text: '', status, summary: true, outputRate });
		else opts.onReasoning({ id: reasoningId, text: reasoningText, status, outputRate });
	};

	const flushResponse = (status: 'streaming' | 'done' | 'error', cutOff?: string) => {
		const text = streamedMessage(response);

		if (text) opts.onMessage?.({ id: responseId, text, status, outputRate, ...(cutOff ? { cutOff } : {}) });
	};

	const callAbort = new AbortController();
	const forwardAbort = () => callAbort.abort();
	const pauseSignal = currentReviewControl()?.pauseSignal;

	opts.signal.addEventListener('abort', forwardAbort, { once: true });
	pauseSignal?.addEventListener('abort', forwardAbort, { once: true });

	const detach = () => {
		opts.signal.removeEventListener('abort', forwardAbort);
		pauseSignal?.removeEventListener('abort', forwardAbort);
	};

	const onReasoning = (chunk: string) => {
		reasoningText = (reasoningText + chunk).slice(0, 64_000);

		if (!overthought && (reasoningText.length > REVIEW_POLICY.maxReasoningChars || isLooping(reasoningText))) {
			overthought = true;
			opts.onLog?.(`${opts.label} reasoning ran long; asking for an answer`);
			callAbort.abort();
		}

		const now = Date.now();

		if (now - reasoningEmittedAt > REASONING_EMIT_MS) {
			reasoningEmittedAt = now;
			flushReasoning();
		}
	};

	let output: string;

	try {
		output = await streamChatCompletion(
			{
				...opts.config,
				messages,
				conversation,
				jsonMode: true,
				jsonSchema: opts.responseSchema?.(lastTurn),
				...sampling(opts.config),
				timeoutMs: opts.callDeadlineMs ?? REVIEW_POLICY.perCallDeadlineMs,
				settleBy: Date.now() + Math.max(1, deadlineAt - reviewNow()),
				signal: callAbort.signal,
				onReasoning: opts.onReasoning ? onReasoning : undefined,
				onRate: (rate) => (outputRate = rate),
				onProgress: (state, elapsedMs) =>
					opts.onProgress?.(state, elapsedMs, state === 'queued' ? 'Waiting for a model slot' : `Running ${opts.label}`)
			},
			(chunk) => {
				response += chunk;

				if (Date.now() - responseEmittedAt > RESPONSE_EMIT_MS) {
					responseEmittedAt = Date.now();
					flushResponse('streaming');
				}
			}
		);

		response = output;
		flushResponse('done');
	} catch (err) {
		detach();

		if (!opts.signal.aborted && pauseSignal?.aborted) {
			flushResponse('done');
			flushReasoning('done');

			return { kind: 'paused' };
		}

		return {
			kind: 'failed',
			err,
			overthought,
			settle: (cutOff) => {
				flushResponse('error', cutOff);
				flushReasoning(overthought ? 'done' : 'error');
			}
		};
	}

	detach();
	flushReasoning('done');

	return { kind: 'reply', output, responseId };
}
