import { aggregateTokenCalls, emptyTokenUsage, type ReviewMetrics, type TokenCall } from '@recoder/shared';
import { expect, test } from 'bun:test';

import { summarizeTokenUsage } from '../../src/lib/metrics/token-usage';
import { sampleChatMetrics, sampleReviewMetrics } from '../../src/lib/sample/sample-metrics';

/** Builds a minimal `ReviewMetrics` payload from raw calls for view-model tests. */
function makeMetrics(calls: TokenCall[], pipelineTracked = true): ReviewMetrics {
	return {
		reviewId: 'rev-1',
		startedAt: '2026-11-14T10:00:00Z',
		pipelineTracked,
		tokenBudget: pipelineTracked ? 'medium' : undefined,
		total: aggregateTokenCalls(calls),
		models: [
			{
				model: 'claude-opus-4-6',
				provider: 'claude-code',
				...aggregateTokenCalls(calls)
			}
		],
		scopes: (['pipeline', 'discussion', 'fix'] as const).map((scope) => ({
			scope,
			...aggregateTokenCalls(calls.filter((call) => call.scope === scope))
		})),
		stages: []
	};
}

test('empty or missing metrics summarize to null', () => {
	expect(summarizeTokenUsage(null, 'review')).toBeNull();
	expect(summarizeTokenUsage(makeMetrics([]), 'chat')).toBeNull();
});

test('a passed sample review splits token types, models and pipeline stages plus follow-ups', () => {
	const metrics = sampleReviewMetrics(
		{
			id: 'rev-passed',
			repoId: 'sample-api',
			prNumber: 214,
			headSha: 'abc1234',
			prTitle: 'Tighten billing retries',
			prUrl: null,
			status: 'passed',
			summary: 'Clean.',
			findings: [],
			runs: [],
			source: 'github',
			createdAt: '2026-11-14T10:00:00Z',
			updatedAt: '2026-11-14T10:05:00Z'
		},
		[
			{
				id: 'msg-1',
				assignmentId: 'orchestrator',
				from: 'assistant',
				text: 'Checked the transaction boundary in billing.',
				at: '2026-11-14T10:05:00Z',
				status: 'done',
				discussion: true
			}
		]
	);

	const summary = summarizeTokenUsage(metrics, 'review');

	expect(summary).not.toBeNull();
	expect(summary?.budgetLabel).toBe('Medium budget');
	expect(summary?.callsLabel).toBe('5 calls');
	expect(summary?.segments.map((segment) => segment.label)).toEqual(['Input', 'Cache read', 'Cache write', 'Output']);
	expect(summary?.models.map((row) => row.model)).toEqual(['Claude Opus 4.6', 'Claude Sonnet 4.6', 'GPT 5.4']);
	expect(summary?.breakdown.map((row) => row.label)).toEqual(['Reviewer', 'Subagent', 'Verifier', 'Follow-ups']);
	expect(summary?.notes).toEqual([]);
});

test('a repository chat suppresses review-only budget and pipelineTracked notes', () => {
	const metrics = sampleChatMetrics({
		id: 'sample-chat',
		repoId: 'sample-api',
		title: 'Billing flow',
		createdAt: '2026-11-14T10:00:00Z',
		updatedAt: '2026-11-14T10:02:00Z',
		messages: [
			{
				id: 'm1',
				from: 'assistant',
				text: 'Here is how the invoice webhook verifies signatures.',
				status: 'done',
				createdAt: '2026-11-14T10:01:00Z'
			},
			{
				id: 'm2',
				from: 'assistant',
				text: 'Checking retries next…',
				status: 'streaming',
				createdAt: '2026-11-14T10:02:00Z'
			}
		]
	} as unknown as Parameters<typeof sampleChatMetrics>[0]);

	const summary = summarizeTokenUsage(metrics, 'chat');

	expect(summary).not.toBeNull();
	expect(summary?.callsLabel).toBe('2 calls · 1 running');
	expect(summary?.budgetLabel).toBeNull();
	expect(summary?.breakdown).toEqual([]);
	expect(summary?.notes).toEqual([]);
});

test('untracked reviews and partial token reporting explain what is left out', () => {
	const metrics = makeMetrics(
		[
			{
				id: 'c1',
				model: 'claude-opus-4-6',
				provider: 'claude-code',
				scope: 'discussion',
				status: 'completed',
				usage: {
					inputTokens: 4_000,
					outputTokens: 500,
					totalTokens: 4_500,
					cachedInputTokens: 2_000,
					cacheWriteInputTokens: null,
					reasoningOutputTokens: null
				}
			},
			{
				id: 'c2',
				model: 'claude-opus-4-6',
				provider: 'claude-code',
				scope: 'discussion',
				status: 'failed',
				usage: emptyTokenUsage()
			}
		],
		false
	);

	const summary = summarizeTokenUsage(metrics, 'review');

	expect(summary?.callsLabel).toBe('2 calls · 1 failed');

	expect(summary?.notes).toEqual([
		'Recording started with a follow-up, so the original review isn’t counted.',
		'Token counts were reported for 1 of 2 calls.'
	]);
});
