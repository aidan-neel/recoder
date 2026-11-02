import { afterEach, expect, test } from 'bun:test';
import type { TokenUsage } from '@recoder/shared';
import { resetLlmLimiter, streamChatCompletion } from '../../../src/models/llm';
import { normalizeTokenUsage } from '../../../src/models/metrics';

const originalFetch = globalThis.fetch;

const opts = {
	baseUrl: 'http://vllm.test/v1',
	apiKey: '',
	model: 'qwen',
	messages: [{ role: 'user' as const, content: 'hi' }]
};

afterEach(() => {
	globalThis.fetch = originalFetch;
	resetLlmLimiter();
});

/** The reply a vLLM server streams: `usage: null` on every chunk until the last one, which has no choices. */
function vllmStream(finalUsage: unknown): Response {
	const chunks = [
		{ choices: [{ index: 0, delta: { role: 'assistant', content: '' } }], usage: null },
		{ choices: [{ index: 0, delta: { content: 'hi' } }], usage: null },
		{ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: null },
		{ choices: [], usage: finalUsage }
	];

	return new Response([...chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`), 'data: [DONE]\n\n'].join(''), {
		headers: { 'content-type': 'text/event-stream' }
	});
}

async function streamedUsage(finalUsage: unknown): Promise<TokenUsage[]> {
	const reports: TokenUsage[] = [];

	globalThis.fetch = (async () => vllmStream(finalUsage)) as unknown as typeof fetch;

	await streamChatCompletion({ ...opts, onUsage: (usage) => reports.push(usage) }, () => {});

	return reports;
}

test('the usage vLLM puts in the last, choice-less chunk is reported once, after chunks that say `usage: null`', async () => {
	const reports = await streamedUsage({
		prompt_tokens: 120,
		completion_tokens: 15,
		total_tokens: 135,
		prompt_tokens_details: null
	});

	expect(reports).toEqual([
		{
			inputTokens: 120,
			outputTokens: 15,
			totalTokens: 135,
			cachedInputTokens: null,
			cacheWriteInputTokens: null,
			reasoningOutputTokens: null
		}
	]);
});

test('a gateway that names the counts input_tokens and output_tokens still reports them', async () => {
	const [usage] = await streamedUsage({ input_tokens: 120, output_tokens: 15 });

	expect(usage).toMatchObject({ inputTokens: 120, outputTokens: 15, totalTokens: 135 });
	expect(normalizeTokenUsage({ prompt_tokens: 7, input_tokens: 9 }, 'openai-compatible').inputTokens).toBe(7);
});
