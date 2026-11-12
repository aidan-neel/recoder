import type { TokenUsage } from '@recoder/shared';

/** The counted fields a cumulative usage total carries, differenced one by one. */
type CountField = Exclude<keyof TokenUsage, 'totalTokens'>;

/**
 * The usage `now` added to the cumulative total `before`: each counted field differenced. A count `now` does not
 * report stays unknown, never zero, and one only `before` lacks counts from zero. `before` null means `now`
 * already is the call's own total, so it is returned as is.
 */
export function usageDelta(now: TokenUsage, before: TokenUsage | null): TokenUsage {
	if (!before) return now;

	const added = (field: CountField): number | null => {
		const count = now[field];

		return count === null ? null : count - (before[field] ?? 0);
	};

	const inputTokens = added('inputTokens');
	const outputTokens = added('outputTokens');

	return {
		inputTokens,
		outputTokens,
		totalTokens: inputTokens !== null && outputTokens !== null ? inputTokens + outputTokens : null,
		cachedInputTokens: added('cachedInputTokens'),
		cacheWriteInputTokens: added('cacheWriteInputTokens'),
		reasoningOutputTokens: added('reasoningOutputTokens')
	};
}
