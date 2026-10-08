import { LlmError } from './errors';
import { requestChat } from './openai-compatible';
import { streamChat } from './openai-stream';
import { withSchemaFallback, withThinkingFallback } from './request-fields';
import type { ModelProvider } from '@recoder/shared';
import type { ChatOptions } from './types';

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

/** A model reached through the user's OpenCode CLI. Loaded lazily for the same reason as ChatGPT. */
const openCode: Transport = async (opts, onToken) => {
	const { opencode } = await import('../../agents/opencode/opencode');

	return opencode.complete(opts, onToken);
};

/** A model reached through the user's Claude Code CLI, one process per call. Loaded lazily like the others. */
const claudeCodeCli: Transport = async (opts, onToken) => {
	const { claudeCode } = await import('../../agents/claude-code/claude-code');

	return claudeCode.complete(opts, onToken);
};

/** A model reached through the user's Devin CLI, one process per call. Loaded lazily like the others. */
const devinCli: Transport = async (opts, onToken) => {
	const { devin } = await import('../../agents/devin/devin');

	return devin.complete(opts, onToken);
};

const TRANSPORTS: Record<ModelProvider, Transport> = {
	'openai-compatible': openAiCompatible,
	codex: chatgpt,
	opencode: openCode,
	'claude-code': claudeCodeCli,
	devin: devinCli
};

export function transportFor(provider: ChatOptions['provider']): Transport {
	return TRANSPORTS[provider ?? 'openai-compatible'];
}
