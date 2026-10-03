/**
 * Model calls for every role. One entry point per call shape; the transport
 * (OpenAI-compatible chat completions or the ChatGPT subscription) is picked
 * from `ChatOptions.provider` in `llm/transports.ts`.
 */

import { runChat } from './llm/run';
import type { ChatOptions } from './llm/types';

export { asLlmError, isTransientLlmError, LlmError } from './llm/errors';
export { resetLlmLimiter } from './llm/limiter';
export { reasoningFields } from './llm/request-fields';
export type { ChatMessage, ChatOptions } from './llm/types';

/** Run one model call and resolve with the full reply. */
export function chatCompletion(opts: ChatOptions): Promise<string> {
	return runChat(opts);
}

/**
 * Streaming variant of {@link chatCompletion}. Forwards each content delta to
 * `onToken` as it arrives and resolves with the full text once the stream ends.
 */
export function streamChatCompletion(opts: ChatOptions, onToken: (text: string) => void): Promise<string> {
	return runChat(opts, onToken);
}
