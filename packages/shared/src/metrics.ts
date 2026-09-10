export type TokenScope = 'pipeline' | 'discussion' | 'fix';

/** Provider-reported counts only. Cached/reasoning counts are breakdowns, not added to total. */
export interface TokenUsage {
	inputTokens: number | null;
	outputTokens: number | null;
	totalTokens: number | null;
	cachedInputTokens: number | null;
	cacheWriteInputTokens: number | null;
	reasoningOutputTokens: number | null;
}

export interface TokenCall {
	id: string;
	model: string;
	provider: 'openai-compatible' | 'codex';
	scope: TokenScope;
	status: 'pending' | 'completed' | 'failed';
	usage: TokenUsage;
}

export interface TokenAggregate {
	calls: number;
	pendingCalls: number;
	failedCalls: number;
	usage: TokenUsage;
	/** Number of calls contributing to each sum; fewer than calls means partial coverage. */
	reportedCalls: Record<keyof TokenUsage, number>;
}

export interface ReviewMetrics {
	reviewId: string;
	startedAt: string;
	pipelineTracked: boolean;
	total: TokenAggregate;
	models: (TokenAggregate & { model: string; provider: TokenCall['provider'] })[];
	scopes: (TokenAggregate & { scope: TokenScope })[];
}

export function emptyTokenUsage(): TokenUsage {
	return { inputTokens: null, outputTokens: null, totalTokens: null, cachedInputTokens: null, cacheWriteInputTokens: null, reasoningOutputTokens: null };
}

export function aggregateTokenCalls(calls: TokenCall[]): TokenAggregate {
	const usage = emptyTokenUsage();
	const reportedCalls = { inputTokens: 0, outputTokens: 0, totalTokens: 0, cachedInputTokens: 0, cacheWriteInputTokens: 0, reasoningOutputTokens: 0 };
	for (const call of calls) {
		for (const key of Object.keys(usage) as (keyof TokenUsage)[]) {
			const value = call.usage[key];
			if (value !== null) {
				usage[key] = (usage[key] ?? 0) + value;
				reportedCalls[key]++;
			}
		}
	}
	return { calls: calls.length, pendingCalls: calls.filter((call) => call.status === 'pending').length, failedCalls: calls.filter((call) => call.status === 'failed').length, usage, reportedCalls };
}
