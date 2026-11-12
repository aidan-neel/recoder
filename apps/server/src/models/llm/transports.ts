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
 * A model an agent CLI runs (OpenCode, Claude Code, Devin, a custom command…), through its adapter in the agent
 * registry. The registry is loaded lazily because its adapters import the `models/llm` entry.
 */
const agentCli: Transport = async (opts, onToken) => {
	const { agentById } = await import('../../agents/registry');
	const agent = agentById(opts.provider);

	if (!agent) throw new LlmError(0, `No agent CLI runs models of provider ${String(opts.provider)}.`);

	return agent.complete(opts, onToken);
};

/** The transports of the providers that are not agent CLIs; every other provider is one. */
const TRANSPORTS: Partial<Record<ModelProvider, Transport>> = {
	'openai-compatible': openAiCompatible
};

export function transportFor(provider: ChatOptions['provider']): Transport {
	return TRANSPORTS[provider ?? 'openai-compatible'] ?? agentCli;
}
