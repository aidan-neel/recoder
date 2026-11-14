import { expect, test } from 'bun:test';
import type { TokenUsage } from '@recoder/shared';
import { LlmError } from '../../../../src/models/llm';
import { getReviewMetrics, withUsageMetrics } from '../../../../src/models/metrics';
import { ModelBudget } from '../../../../src/review/pipeline/agent-loop/budget';
import type { JsonAgentOptions } from '../../../../src/review/pipeline/agent-loop/options';
import { StepRelay } from '../../../../src/review/pipeline/agent-loop/step-relay';
import { db, reviewMetrics } from '../../../../src/store';
import { testReview } from '../../../helpers/review';
import { useTempStore } from '../../../helpers/temp-store';

const store = useTempStore('recoder-relay-');

function usage(input: number, output: number): TokenUsage {
	return {
		inputTokens: input,
		outputTokens: output,
		totalTokens: input + output,
		cachedInputTokens: 0,
		cacheWriteInputTokens: 0,
		reasoningOutputTokens: 0
	};
}

/** A relay for a review's agent, run inside that review's pipeline so its calls are recorded. */
async function relay(): Promise<{ reviewId: string; run: <T>(work: (relay: StepRelay<unknown>) => T) => Promise<T> }> {
	const review = await db.reviews.set(testReview({ repoId: 'missing-repo' }));
	const opts = { label: 'reviewer', config: { model: 'vllm/qwen' }, budget: new ModelBudget(), maxTurns: 8 };

	store.track(review.id);

	const target = new StepRelay(opts as unknown as JsonAgentOptions<unknown>, {
		onStep: () => {},
		onStepDone: () => {},
		onOverthought: () => {}
	});

	return {
		reviewId: review.id,
		run: async (work) => await withUsageMetrics(review.id, 'pipeline', () => work(target))
	};
}

async function calls(reviewId: string): Promise<TokenUsage['totalTokens'][]> {
	return (await reviewMetrics.get(reviewId))!.calls.map((call) => call.usage.totalTokens);
}

test('a step that ends after the next one has started still gets its own usage', async () => {
	const { reviewId, run } = await relay();

	await run(async (target) => {
		target.onEvent({ type: 'step-start', step: 'msg_1' });
		target.onEvent({ type: 'step-start', step: 'msg_2' });
		target.onEvent({ type: 'usage', usage: usage(100, 10), step: 'msg_1' });
		target.onEvent({ type: 'usage', usage: usage(200, 20), step: 'msg_2' });
		await target.finishPrompt(undefined);
	});

	expect(await calls(reviewId)).toEqual([110, 220]);
});

test('usage that arrives just after the prompt answered is recorded on the step it belongs to', async () => {
	const { reviewId, run } = await relay();

	await run(async (target) => {
		target.onEvent({ type: 'step-start', step: 'msg_1' });
		setTimeout(() => target.onEvent({ type: 'usage', usage: usage(100, 10), step: 'msg_1' }), 50);
		await target.finishPrompt(undefined);
	});

	expect(await calls(reviewId)).toEqual([110]);
});

test('a prompt whose step events never arrived still counts as a request with the prompt’s own tokens', async () => {
	const { reviewId, run } = await relay();

	await run((target) => target.finishPrompt(usage(120, 15)));

	expect((await getReviewMetrics(reviewId))?.total).toMatchObject({ calls: 1, usage: { totalTokens: 135 } });
});

test('a prompt that failed before any step started counts one failed request with the provider error', async () => {
	const { reviewId, run } = await relay();

	await run((target) => target.finishPrompt(undefined, new LlmError(0, 'AI_APICallError: Go usage limit exceeded')));

	expect((await reviewMetrics.get(reviewId))?.calls).toMatchObject([
		{ status: 'failed', error: 'AI_APICallError: Go usage limit exceeded' }
	]);
});

test('a single step without a usage event takes the prompt’s tokens, but several are not guessed at', async () => {
	const one = await relay();

	await one.run(async (target) => {
		target.onEvent({ type: 'step-start', step: 'msg_1' });
		await target.finishPrompt(usage(120, 15));
	});

	expect(await calls(one.reviewId)).toEqual([135]);

	const two = await relay();

	await two.run(async (target) => {
		target.onEvent({ type: 'step-start', step: 'msg_1' });
		target.onEvent({ type: 'step-start', step: 'msg_2' });
		target.onEvent({ type: 'usage', usage: usage(100, 10), step: 'msg_1' });
		await target.finishPrompt(usage(300, 30));
	});

	expect(await calls(two.reviewId)).toEqual([110, null]);
});
