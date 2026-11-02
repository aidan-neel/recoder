import { afterAll, afterEach, beforeAll, expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TokenUsage } from '@recoder/shared';
import { getReviewMetrics, withReviewMetrics } from '../../../../src/models/metrics';
import { ModelBudget } from '../../../../src/review/pipeline/agent-loop/budget';
import type { JsonAgentOptions } from '../../../../src/review/pipeline/agent-loop/options';
import { StepRelay } from '../../../../src/review/pipeline/agent-loop/opencode-relay';
import { closeStore, db, reviewMetrics } from '../../../../src/store';
import { testReview } from '../../../helpers/review';

const originalDataDir = process.env.RECODER_DATA_DIR;
const ids: string[] = [];

beforeAll(() => {
	process.env.RECODER_DATA_DIR = mkdtempSync(join(tmpdir(), 'recoder-relay-'));
	closeStore();
});

afterAll(() => {
	closeStore();
	if (originalDataDir === undefined) delete process.env.RECODER_DATA_DIR;
	else process.env.RECODER_DATA_DIR = originalDataDir;
});

afterEach(() => {
	for (const id of ids.splice(0)) {
		db.reviews.delete(id);
		reviewMetrics.delete(id);
	}
});

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
function relay(): { reviewId: string; run: <T>(work: (relay: StepRelay<unknown>) => T) => T } {
	const review = db.reviews.set(testReview({ repoId: 'missing-repo' }));
	const opts = { label: 'reviewer', config: { model: 'vllm/qwen' }, budget: new ModelBudget(), maxTurns: 8 };

	ids.push(review.id);

	const target = new StepRelay(opts as unknown as JsonAgentOptions<unknown>, {
		onStep: () => {},
		onStepDone: () => {},
		onOverthought: () => {}
	});

	return { reviewId: review.id, run: (work) => withReviewMetrics(review.id, 'pipeline', () => work(target)) };
}

function calls(reviewId: string): TokenUsage['totalTokens'][] {
	return reviewMetrics.get(reviewId)!.calls.map((call) => call.usage.totalTokens);
}

test('a step that ends after the next one has started still gets its own usage', async () => {
	const { reviewId, run } = relay();

	await run(async (target) => {
		target.handlers.onStepStart?.('msg_1');
		target.handlers.onStepStart?.('msg_2');
		target.handlers.onStepFinish?.(usage(100, 10), 'msg_1');
		target.handlers.onStepFinish?.(usage(200, 20), 'msg_2');
		await target.finishPrompt(undefined, true);
	});

	expect(calls(reviewId)).toEqual([110, 220]);
});

test('usage that arrives just after the prompt answered is recorded on the step it belongs to', async () => {
	const { reviewId, run } = relay();

	await run(async (target) => {
		target.handlers.onStepStart?.('msg_1');
		setTimeout(() => target.handlers.onStepFinish?.(usage(100, 10), 'msg_1'), 50);
		await target.finishPrompt(undefined, true);
	});

	expect(calls(reviewId)).toEqual([110]);
});

test('a prompt whose step events never arrived still counts as a request with the prompt’s own tokens', async () => {
	const { reviewId, run } = relay();

	await run((target) => target.finishPrompt(usage(120, 15), true));

	expect(getReviewMetrics(reviewId)?.total).toMatchObject({ calls: 1, usage: { totalTokens: 135 } });
});

test('a prompt that failed before any step reported nothing counts no request', async () => {
	const { reviewId, run } = relay();

	await run((target) => target.finishPrompt(undefined, false));

	expect(reviewMetrics.get(reviewId)?.calls ?? []).toEqual([]);
});

test('a single step without a usage event takes the prompt’s tokens, but several are not guessed at', async () => {
	const one = relay();

	await one.run(async (target) => {
		target.handlers.onStepStart?.('msg_1');
		await target.finishPrompt(usage(120, 15), true);
	});

	expect(calls(one.reviewId)).toEqual([135]);

	const two = relay();

	await two.run(async (target) => {
		target.handlers.onStepStart?.('msg_1');
		target.handlers.onStepStart?.('msg_2');
		target.handlers.onStepFinish?.(usage(100, 10), 'msg_1');
		await target.finishPrompt(usage(300, 30), true);
	});

	expect(calls(two.reviewId)).toEqual([110, null]);
});
