import { LlmError } from './errors';
import { requestChat } from './openai-compatible';
import { streamChat } from './openai-stream';
import { withSchemaFallback, withThinkingFallback } from './request-fields';
import type { ChatOptions, ChatProvider } from './types';

/**
 * One attempt at a model call through a provider's API. `opts.timeoutMs` is
 * this attempt's budget; `onToken`, when given, receives streamed text.
 * Retries, the concurrency slot and the hard deadline are handled by the caller.
 */
type Transport = (opts: ChatOptions, onToken?: (text: string) => void) => Promise<string>;

/**
 * POST `{baseUrl}/chat/completions` on vLLM, OpenRouter, DashScope or anything
 * else OpenAI-compatible. A non-streaming call that wants reasoning still streams,
 * since that is how most servers disclose it.
 */
const openAiCompatible: Transport = (opts, onToken) =>
	withThinkingFallback(opts, () =>
		withSchemaFallback(opts, () =>
			onToken || opts.onReasoning ? streamChat(opts, onToken ?? (() => {})) : requestChat(opts)
		)
	);

/**
 * ChatGPT through the user's subscription. The adapter is loaded lazily because
 * it imports the `models/llm` entry. A non-streaming call hides non-LLM
 * failures behind a generic message.
 */
const chatgpt: Transport = async (opts, onToken) => {
	const { codex } = await import('../../agents/codex/codex');

	if (onToken) return codex.complete(opts, onToken);

	try {
		return await codex.complete(opts);
	} catch (error) {
		if (error instanceof LlmError) throw error;
		throw new LlmError(0, 'ChatGPT request failed');
	}
};

const TRANSPORTS: Record<ChatProvider, Transport> = {
	'openai-compatible': openAiCompatible,
	codex: chatgpt
};

export function transportFor(provider: ChatOptions['provider']): Transport {
	return TRANSPORTS[provider ?? 'openai-compatible'];
}
