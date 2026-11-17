import {
	aggregateTokenCalls,
	TOKEN_STAGES,
	type RepoChat,
	type Review,
	type ReviewChatMessage,
	type ReviewMetrics,
	type TokenCall,
	type TokenScope,
	type TokenStage
} from '@recoder/shared';

interface CallSeed {
	id: string;
	model: string;
	provider: TokenCall['provider'];
	scope: TokenScope;
	stage?: TokenStage;
	status?: TokenCall['status'];
	input: number;
	output: number;
	cached?: number;
	cacheWrite?: number;
	reasoning?: number;
}

const SCOPES: readonly TokenScope[] = ['pipeline', 'discussion', 'fix'];

/** Builds a `TokenCall` with coherent totals from compact numbers. */
function makeCall({
	id,
	model,
	provider,
	scope,
	stage,
	status = 'completed',
	input,
	output,
	cached = 0,
	cacheWrite = 0,
	reasoning = 0
}: CallSeed): TokenCall {
	return {
		id,
		model,
		provider,
		scope,
		stage,
		status,
		usage: {
			inputTokens: input,
			outputTokens: output,
			totalTokens: input + output,
			cachedInputTokens: cached > 0 ? cached : null,
			cacheWriteInputTokens: cacheWrite > 0 ? cacheWrite : null,
			reasoningOutputTokens: reasoning > 0 ? reasoning : null
		}
	};
}

/** Summarizes a list of sample calls into the `ReviewMetrics` shape the server returns. */
function buildMetrics(ownerId: string, startedAt: string, pipelineTracked: boolean, calls: TokenCall[]): ReviewMetrics {
	const byModel = new Map<string, TokenCall[]>();

	for (const call of calls) {
		const bucket = `${call.provider}\0${call.model}`;
		const list = byModel.get(bucket);

		if (list) list.push(call);
		else byModel.set(bucket, [call]);
	}

	const pipelineCalls = calls.filter((call) => call.scope === 'pipeline');

	return {
		reviewId: ownerId,
		startedAt,
		pipelineTracked,
		...(pipelineTracked ? { tokenBudget: 'medium' as const } : {}),
		total: aggregateTokenCalls(calls),
		models: [...byModel.values()].map((group) => ({
			model: group[0].model,
			provider: group[0].provider,
			...aggregateTokenCalls(group)
		})),
		scopes: SCOPES.map((scope) => ({
			scope,
			...aggregateTokenCalls(calls.filter((call) => call.scope === scope))
		})),
		stages: TOKEN_STAGES.flatMap((stage) => {
			const matching = pipelineCalls.filter((call) => (call.stage ?? 'other') === stage);

			return matching.length > 0 ? [{ stage, ...aggregateTokenCalls(matching) }] : [];
		})
	};
}

/** Sample token calls for a pull request review, reflecting its current lifecycle state and follow-ups. */
export function sampleReviewMetrics(review: Review, messages: readonly ReviewChatMessage[] = []): ReviewMetrics | null {
	const replies = messages.filter((entry) => entry.from === 'assistant');

	if (review.status === 'queued' || (review.status === 'draft' && replies.length === 0)) return null;

	const pipeline: TokenCall[] =
		review.status === 'draft'
			? []
			: review.status === 'running'
				? [
						makeCall({
							id: `${review.id}-p1`,
							model: 'claude-opus-4-6',
							provider: 'claude-code',
							scope: 'pipeline',
							stage: 'reviewer',
							input: 42_800,
							output: 3_640,
							cached: 28_400,
							cacheWrite: 6_200
						}),
						makeCall({
							id: `${review.id}-p2`,
							model: 'gpt-5.4',
							provider: 'codex',
							scope: 'pipeline',
							stage: 'subagent',
							input: 19_400,
							output: 2_180,
							cached: 12_600,
							reasoning: 940
						}),
						makeCall({
							id: `${review.id}-p3`,
							model: 'claude-opus-4-6',
							provider: 'claude-code',
							scope: 'pipeline',
							stage: 'verifier',
							status: 'pending',
							input: 14_200,
							output: 620,
							cached: 11_800
						})
					]
				: [
						makeCall({
							id: `${review.id}-p1`,
							model: 'claude-opus-4-6',
							provider: 'claude-code',
							scope: 'pipeline',
							stage: 'reviewer',
							input: 64_200,
							output: 5_480,
							cached: 46_100,
							cacheWrite: 8_900
						}),
						makeCall({
							id: `${review.id}-p2`,
							model: 'gpt-5.4',
							provider: 'codex',
							scope: 'pipeline',
							stage: 'reviewer',
							input: 51_600,
							output: 4_920,
							cached: 36_400,
							reasoning: 2_140
						}),
						makeCall({
							id: `${review.id}-p3`,
							model: 'claude-sonnet-4-6',
							provider: 'claude-code',
							scope: 'pipeline',
							stage: 'subagent',
							input: 38_400,
							output: 3_120,
							cached: 29_800,
							cacheWrite: 3_400
						}),
						makeCall({
							id: `${review.id}-p4`,
							model: 'claude-opus-4-6',
							provider: 'claude-code',
							scope: 'pipeline',
							stage: 'verifier',
							input: 27_900,
							output: 2_310,
							cached: 22_400
						})
					];

	const discussion = replies.map((reply, index) =>
		makeCall({
			id: `${review.id}-d${index + 1}`,
			model: 'claude-sonnet-4-6',
			provider: 'claude-code',
			scope: 'discussion',
			status: reply.status === 'streaming' ? 'pending' : reply.status === 'error' ? 'failed' : 'completed',
			input: 18_400 + index * 6_200,
			output: Math.max(180, Math.round(reply.text.length * 0.35)),
			cached: 14_200 + index * 5_400,
			cacheWrite: index === 0 ? 2_800 : 600
		})
	);

	return buildMetrics(review.id, review.createdAt, pipeline.length > 0, [...pipeline, ...discussion]);
}

/** Sample token calls for a repository chat, growing turn by turn as messages stream and finish. */
export function sampleChatMetrics(chat: RepoChat): ReviewMetrics | null {
	const replies = chat.messages.filter((message) => message.from === 'assistant');

	if (replies.length === 0) return null;

	const calls = replies.map((reply, index) => {
		const streaming = reply.status === 'streaming';
		const failed = reply.status === 'error';
		const words = Math.max(120, Math.round(reply.text.length * 0.38));

		return makeCall({
			id: `${chat.id}-c${index + 1}`,
			model: index % 3 === 2 ? 'claude-opus-4-6' : 'claude-sonnet-4-6',
			provider: 'claude-code',
			scope: 'discussion',
			status: streaming ? 'pending' : failed ? 'failed' : 'completed',
			input: 14_800 + index * 8_600,
			output: streaming ? Math.max(90, Math.round(reply.text.length * 0.32)) : words + 420,
			cached: 9_600 + index * 7_400,
			cacheWrite: index === 0 ? 3_200 : 950
		});
	});

	return buildMetrics(chat.id, chat.createdAt, false, calls);
}
