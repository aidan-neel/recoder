import { z } from 'zod';
import type { TokenUsage } from '@recoder/shared';

/** Both OpenCode versions count tokens this way. */
export const tokensSchema = z.object({
	input: z.number(),
	output: z.number(),
	reasoning: z.number(),
	cache: z.object({ read: z.number(), write: z.number() })
});

/**
 * OpenCode counts cached input and reasoning apart from `input` and `output`;
 * Recoder's usage holds them as breakdowns, so they are added back in.
 */
export function usage(tokens: z.infer<typeof tokensSchema>): TokenUsage {
	const inputTokens = tokens.input + tokens.cache.read + tokens.cache.write;
	const outputTokens = tokens.output + tokens.reasoning;

	return {
		inputTokens,
		outputTokens,
		totalTokens: inputTokens + outputTokens,
		cachedInputTokens: tokens.cache.read,
		cacheWriteInputTokens: tokens.cache.write,
		reasoningOutputTokens: tokens.reasoning
	};
}
