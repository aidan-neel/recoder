import { expect, test } from 'bun:test';
import { normalizeTokenUsage } from '../../src/models/metrics';

const usage = {
	prompt_tokens: 100,
	completion_tokens: 30,
	total_tokens: 130,
	prompt_tokens_details: { cached_tokens: 40, cache_write_tokens: 10 },
	completion_tokens_details: { reasoning_tokens: 20 }
};

test('normalization preserves missing versus zero and never adds breakdowns to totals', () => {
	expect(normalizeTokenUsage(usage)).toEqual({
		inputTokens: 100,
		outputTokens: 30,
		totalTokens: 130,
		cachedInputTokens: 40,
		cacheWriteInputTokens: 10,
		reasoningOutputTokens: 20
	});

	expect(normalizeTokenUsage({ prompt_tokens: 0, completion_tokens: 0 })).toMatchObject({
		inputTokens: 0,
		outputTokens: 0,
		totalTokens: 0,
		cachedInputTokens: null
	});

	expect(normalizeTokenUsage({ prompt_tokens: null, completion_tokens: '10', total_tokens: -1 })).toMatchObject({
		inputTokens: null,
		outputTokens: null,
		totalTokens: null
	});
});
