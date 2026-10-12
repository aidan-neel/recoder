import type { ChatMessage } from '../../../models/llm.js';

/** What an old tool result becomes once the transcript is compacted. */
const STUB = '[Earlier tool output removed to keep the conversation small. Request it again if you still need it.]';

/** The latest tool results, kept whole however large the transcript grows. */
const KEEP_RECENT = 2;

function size(messages: ChatMessage[]): number {
	return messages.reduce((total, message) => total + message.content.length, 0);
}

/**
 * Stubs the oldest of `toolResults`, in place, until `messages` fits in
 * `maxChars`, and returns how many it stubbed. The system prompt, the opening
 * brief and the latest results stay whole. A stubbed result stays stubbed, so
 * the transcript changes only when it grows past the limit, and the
 * provider's cached prefix holds until then.
 */
export function compactTranscript(messages: ChatMessage[], toolResults: ChatMessage[], maxChars: number): number {
	let total = size(messages);
	let stubbed = 0;

	for (const message of toolResults.slice(0, -KEEP_RECENT)) {
		if (total <= maxChars) break;
		if (message.content === STUB) continue;

		total -= message.content.length - STUB.length;
		message.content = STUB;
		stubbed++;
	}

	return stubbed;
}
