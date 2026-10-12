import type { ModelProvider } from './models';

export type TokenScope = 'pipeline' | 'discussion' | 'fix';

/** The kinds of agent that make calls, so a review's tokens can be split by the work that spent them. */
export const TOKEN_STAGES = [
	'reviewer',
	'subagent',
	'second-look',
	'investigator',
	'worker',
	'verifier',
	'repair',
	'intent',
	'ledger',
	'other'
] as const;

export type TokenStage = (typeof TOKEN_STAGES)[number];

/** Provider-reported counts only. Cached/reasoning counts are breakdowns, not added to total. */
export interface TokenUsage {
	inputTokens: number | null;
	outputTokens: number | null;
	totalTokens: number | null;
	cachedInputTokens: number | null;
	cacheWriteInputTokens: number | null;
	reasoningOutputTokens: number | null;
}

/** How fast one model call produces output, in tokens per second. */
export interface OutputRate {
	tokensPerSecond: number;
	/** Counted from the streamed text, while the call runs or when the provider reports no output tokens. */
	estimated: boolean;
}

export interface TokenCall {
	id: string;
	model: string;
	provider: ModelProvider;
	scope: TokenScope;
	/** Unset on calls made outside an agent run and on rows stored before stages were recorded. */
	stage?: TokenStage;
	status: 'pending' | 'completed' | 'failed';
	usage: TokenUsage;
	/** What paid for a Claude Code call, as the CLI reports it: `none` is the signed-in subscription, not a key. */
	apiKeySource?: string;
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
	/** Pipeline calls by the kind of agent that made them; stages with no calls are left out. */
	stages: (TokenAggregate & { stage: TokenStage })[];
}

export function emptyTokenUsage(): TokenUsage {
	return {
		inputTokens: null,
		outputTokens: null,
		totalTokens: null,
		cachedInputTokens: null,
		cacheWriteInputTokens: null,
		reasoningOutputTokens: null
	};
}

export function aggregateTokenCalls(calls: TokenCall[]): TokenAggregate {
	const usage = emptyTokenUsage();

	const reportedCalls = {
		inputTokens: 0,
		outputTokens: 0,
		totalTokens: 0,
		cachedInputTokens: 0,
		cacheWriteInputTokens: 0,
		reasoningOutputTokens: 0
	};

	for (const call of calls) {
		for (const key of Object.keys(usage) as (keyof TokenUsage)[]) {
			const value = call.usage[key];

			if (value !== null) {
				usage[key] = (usage[key] ?? 0) + value;
				reportedCalls[key]++;
			}
		}
	}

	return {
		calls: calls.length,
		pendingCalls: calls.filter((call) => call.status === 'pending').length,
		failedCalls: calls.filter((call) => call.status === 'failed').length,
		usage,
		reportedCalls
	};
}
