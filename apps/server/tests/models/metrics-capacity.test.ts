import { afterEach, expect, setSystemTime, test } from 'bun:test';
import type { Review } from '@recoder/shared';
import { db, reviewMetrics } from '../../src/store';
import { getReviewMetrics, withUsageMetrics } from '../../src/models/metrics';
import { acquireLlmSlot, releaseLlmSlot, resetLlmLimiter } from '../../src/models/llm/limiter';
import { withLease } from '../../src/review/runtime/ownership';
import { testReview } from '../helpers/review';

const ENDPOINT = 'https://model.test/v1';

const START = new Date('2026-01-01T00:00:00Z').getTime();

const savedConcurrency = process.env.RECODER_LLM_CONCURRENCY;

const ids: string[] = [];

async function review(): Promise<Review> {
	const value = testReview({ status: 'running' });

	ids.push(value.id);

	return await db.reviews.set(value);
}

afterEach(async () => {
	setSystemTime();
	resetLlmLimiter();

	if (savedConcurrency === undefined) delete process.env.RECODER_LLM_CONCURRENCY;
	else process.env.RECODER_LLM_CONCURRENCY = savedConcurrency;

	for (const id of ids.splice(0)) {
		await db.reviews.delete(id);
		await reviewMetrics.delete(id);
	}
});

test('a pipeline run adds up how long its model requests waited for a slot', async () => {
	const a = await review();

	process.env.RECODER_LLM_CONCURRENCY = '1';
	setSystemTime(new Date(START));
	await acquireLlmSlot(ENDPOINT);

	await withUsageMetrics(a.id, 'pipeline', async () => {
		const queued = acquireLlmSlot(ENDPOINT);

		setSystemTime(new Date(START + 1500));
		releaseLlmSlot(ENDPOINT);
		await queued;
		releaseLlmSlot(ENDPOINT);
		await acquireLlmSlot(ENDPOINT);
		releaseLlmSlot(ENDPOINT);
	});

	expect((await getReviewMetrics(a.id))?.queueDelay).toEqual({ requests: 2, totalMs: 1500, maxMs: 1500 });
});

test('a pipeline run under a review worker names that worker on the review metrics', async () => {
	const a = await review();
	const lease = { reviewId: a.id, ownerId: 'replica-a', epoch: '1', expiresAt: new Date(START) };

	await withLease(lease, () => withUsageMetrics(a.id, 'pipeline', async () => undefined));

	expect((await getReviewMetrics(a.id))?.worker).toBe('replica-a');
});
