import { expect, test } from 'bun:test';
import { aggregateTokenCalls, emptyTokenUsage, type TokenCall } from './metrics';

test('empty and unreported usage is not fabricated as zero', () => {
	expect(aggregateTokenCalls([])).toMatchObject({ calls: 0, usage: { inputTokens: null, outputTokens: null, totalTokens: null }, reportedCalls: { inputTokens: 0 } });
});

test('each aggregate field tracks its own coverage and preserves reported zero', () => {
	const call: TokenCall = { id: '1', model: 'test', provider: 'codex', scope: 'pipeline', status: 'completed', usage: { ...emptyTokenUsage(), inputTokens: 100, outputTokens: 10, totalTokens: 110, cachedInputTokens: 0 } };
	const result = aggregateTokenCalls([call, { ...call, id: '2', status: 'failed', usage: { ...emptyTokenUsage(), inputTokens: 50 } }, { ...call, id: '3', status: 'pending', usage: emptyTokenUsage() }]);
	expect(result).toMatchObject({ calls: 3, failedCalls: 1, pendingCalls: 1, usage: { inputTokens: 150, outputTokens: 10, totalTokens: 110, cachedInputTokens: 0, reasoningOutputTokens: null }, reportedCalls: { inputTokens: 2, outputTokens: 1, totalTokens: 1, cachedInputTokens: 1, reasoningOutputTokens: 0 } });
});
