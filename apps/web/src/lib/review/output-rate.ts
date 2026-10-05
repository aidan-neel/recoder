import type { OutputRate, ReviewChatMessage, ReviewReasoningEntry } from '@recoder/shared';

/** A measured speed and the reply or thought it belongs to. */
export interface MeasuredRate {
	id: string;
	rate: OutputRate;
}

/**
 * The newest model speed in a conversation. Replies mirrored in from other
 * agents ran on their own models, so they don't count.
 */
export function latestOutputRate(
	messages: ReviewChatMessage[],
	reasoning: ReviewReasoningEntry[]
): MeasuredRate | null {
	let latest: (ReviewChatMessage | ReviewReasoningEntry) | null = null;

	for (const entry of [...reasoning, ...messages.filter((message) => !message.forwardedFrom)]) {
		if (entry.outputRate && (!latest || Date.parse(entry.at) >= Date.parse(latest.at))) latest = entry;
	}

	return latest?.outputRate ? { id: latest.id, rate: latest.outputRate } : null;
}

/** "84 tok/s", or "~84 tok/s" while it is still an estimate. */
export function formatOutputRate(rate: OutputRate): string {
	return `${rate.estimated ? '~' : ''}${rate.tokensPerSecond} tok/s`;
}
