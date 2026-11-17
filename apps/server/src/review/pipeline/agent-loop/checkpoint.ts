import { z } from 'zod';
import { extractJsonValue } from '../../../models/json-extract.js';
import type { ChatConversation, ChatMessage } from '../../../models/llm.js';

import { reviewNow, reviewPausePoint } from '../../session/review-control.js';
import { throwIfAborted } from './budget.js';
import type { AgentLimits } from './limits.js';
import { callSettleAt } from './limits.js';
import type { JsonAgentOptions } from './options.js';
import { streamTurn, type TurnResult } from './stream-turn.js';

export const MAX_CHECKPOINTS = 3;

const schema = z.object({
	examined: z.array(z.string()),
	candidates: z.array(
		z.object({ title: z.string(), file: z.string(), line: z.number(), claim: z.string(), evidence: z.string() })
	),
	facts: z.array(z.string()),
	openLeads: z.array(z.string()),
	next: z.string()
});

export const CHECKPOINT_REQUEST =
	'Return checkpoint JSON with examined (string array), candidates (array of {title, file, line, claim, evidence}), facts (string array), openLeads (string array), and next (string). Preserve all findings, evidence and open leads.';

export function transcriptChars(messages: ChatMessage[]): number {
	return messages.reduce((total, message) => total + message.content.length, 0);
}

export function applyCheckpoint(messages: ChatMessage[], toolResults: ChatMessage[], output: string): boolean {
	let parsed: unknown;

	try {
		parsed = extractJsonValue(output);
	} catch {
		return false;
	}

	const checkpoint = schema.safeParse(parsed);

	if (!checkpoint.success) return false;

	const recent = toolResults.slice(-2);

	const rounds = recent.flatMap((result) => {
		const previous = messages[messages.indexOf(result) - 1];

		return previous?.role === 'assistant' ? [previous, result] : [result];
	});

	const opening = messages.slice(0, 2);

	const toolMessages = new Set(
		toolResults.flatMap((result) => {
			const previous = messages[messages.indexOf(result) - 1];

			return previous?.role === 'assistant' ? [previous, result] : [result];
		})
	);

	const notes = messages
		.slice(2)
		.filter((message) => !toolMessages.has(message) && !message.content.startsWith('Checkpoint of your work so far:'));

	messages.splice(
		0,
		messages.length,
		...opening,
		{ role: 'user', content: `Checkpoint of your work so far:\n${JSON.stringify(checkpoint.data)}` },
		...notes,
		...rounds
	);

	toolResults.splice(0, toolResults.length, ...recent);

	return true;
}

/** Append a checkpoint request without rewriting the cached prefix; failed attempts leave the transcript intact. */
export async function requestCheckpoint<T>(
	opts: JsonAgentOptions<T>,
	messages: ChatMessage[],
	toolResults: ChatMessage[],
	conversation: ChatConversation,
	turn: number,
	limits: AgentLimits
): Promise<Exclude<TurnResult, { kind: 'reply' | 'paused' }> | null> {
	const originalLength = messages.length;
	let applied = false;
	const settleAt = callSettleAt(limits, false);

	messages.push({ role: 'user', content: CHECKPOINT_REQUEST });

	try {
		for (let attempt = 0; attempt < 2; attempt++) {
			await reviewPausePoint(opts.signal);
			throwIfAborted(opts.signal);

			if (
				reviewNow() >= Math.min(settleAt, limits.finalTurnAt) ||
				!opts.budget.canSpend(2, { consumeReserve: opts.consumeReserve })
			)
				break;

			opts.budget.spend();

			const result = await streamTurn(
				{ ...opts, responseSchema: undefined, onMessage: undefined },
				messages,
				conversation,
				turn,
				false,
				settleAt
			);

			if (result.kind === 'paused') {
				opts.budget.used = Math.max(0, opts.budget.used - 1);
				attempt--;
				continue;
			}

			if (result.kind !== 'reply') return result;

			throwIfAborted(opts.signal);

			const original = messages.slice(0, originalLength);

			if (applyCheckpoint(original, toolResults, result.output)) {
				messages.splice(0, messages.length, ...original);
				applied = true;

				return null;
			}

			messages.push({ role: 'assistant', content: result.output });
			messages.push({ role: 'user', content: `Invalid checkpoint. ${CHECKPOINT_REQUEST}` });
		}

		return null;
	} finally {
		if (!applied) messages.splice(originalLength);
	}
}
