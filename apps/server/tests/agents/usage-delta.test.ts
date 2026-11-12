import { describe, expect, test } from 'bun:test';
import type { TokenUsage } from '@recoder/shared';
import { usageDelta } from '../../src/agents/usage-delta';

const total = (over: Partial<TokenUsage>): TokenUsage => ({
	inputTokens: null,
	outputTokens: null,
	totalTokens: null,
	cachedInputTokens: null,
	cacheWriteInputTokens: null,
	reasoningOutputTokens: null,
	...over
});

describe('usageDelta', () => {
	test('the first total is the call’s own usage, returned as is', () => {
		const now = total({ inputTokens: 1000, outputTokens: 20, totalTokens: 1020 });

		expect(usageDelta(now, null)).toBe(now);
	});

	test('a cumulative total diffs field by field against the earlier one', () => {
		const before = total({
			inputTokens: 400,
			outputTokens: 10,
			totalTokens: 410,
			cachedInputTokens: 100,
			cacheWriteInputTokens: null,
			reasoningOutputTokens: null
		});

		const now = total({
			inputTokens: 1000,
			outputTokens: 20,
			totalTokens: 1020,
			cachedInputTokens: 600,
			cacheWriteInputTokens: 5,
			reasoningOutputTokens: null
		});

		expect(usageDelta(now, before)).toEqual({
			inputTokens: 600,
			outputTokens: 10,
			totalTokens: 610,
			cachedInputTokens: 500,
			cacheWriteInputTokens: 5,
			reasoningOutputTokens: null
		});
	});

	test('a count either side does not report stays unknown, never zero', () => {
		const before = total({ inputTokens: 400, outputTokens: 10 });
		const now = total({ inputTokens: 1000, outputTokens: null, cachedInputTokens: 50 });

		expect(usageDelta(now, before)).toEqual({
			inputTokens: 600,
			outputTokens: null,
			totalTokens: null,
			cachedInputTokens: 50,
			cacheWriteInputTokens: null,
			reasoningOutputTokens: null
		});
	});
});
