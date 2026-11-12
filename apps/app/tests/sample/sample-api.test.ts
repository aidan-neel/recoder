import { afterEach, beforeEach, describe, expect, jest, test } from 'bun:test';
import { applyProgressMessage, emptyReviewProgress, REVIEW_CANCELLED, type ProgressMessage } from '@recoder/shared';

import { createSampleApi } from '../../src/lib/sample/sample-api';

/** Time enough for a started review to leave the queue. */
const QUEUE_MS = 1_000;

/** Time enough for a review that left the queue to reach the step that checks its claims. */
const TO_VERIFY_MS = 10_000;

beforeEach(() => {
	jest.useFakeTimers();
});

afterEach(() => {
	jest.useRealTimers();
});

/**
 * A draft session on a pull request with no review, where a person asked a
 * question, then started the review and paused it once it left the queue;
 * with every message its stream sent.
 */
async function askedStartedAndPaused() {
	const api = createSampleApi();
	const draft = await api.createReview({ repoId: 'sample-api', prNumber: 205, start: false });
	const messages: ProgressMessage[] = [];

	api.follow(draft.id, { onMessage: (message) => messages.push(message), onConnection: () => {}, onStale: () => {} });
	await Promise.resolve();
	await api.sendChat(draft.id, 'What changed?');
	await api.startDraft(draft.id);
	jest.advanceTimersByTime(QUEUE_MS);
	await api.pauseReview(draft.id);

	return { id: draft.id, messages };
}

/** The progress a page shows after taking every message in order. */
function shownProgress(id: string, messages: ProgressMessage[]) {
	return messages.reduce(applyProgressMessage, emptyReviewProgress(id));
}

describe('a draft session that starts a review', () => {
	test('pausing the review keeps the conversation asked before it started', async () => {
		const { messages } = await askedStartedAndPaused();

		expect(messages.at(-1)?.snapshot?.messages?.map((message) => message.text)).toContain('What changed?');
	});

	test('the page takes each step the review publishes after the conversation’s messages', async () => {
		const { id, messages } = await askedStartedAndPaused();

		expect(shownProgress(id, messages)).toMatchObject({ paused: true, stage: 'checkout' });
	});
});

describe('the seeded review that is already running', () => {
	test('it pauses like a review started here', async () => {
		const api = createSampleApi();
		const messages: ProgressMessage[] = [];

		api.follow('sample-216', {
			onMessage: (message) => messages.push(message),
			onConnection: () => {},
			onStale: () => {}
		});

		await api.pauseReview('sample-216');

		expect(messages.at(-1)?.snapshot?.paused).toBe(true);
	});

	test('it stops like a review started here', async () => {
		const api = createSampleApi();

		await api.cancelReview('sample-216');

		expect(await api.review('sample-216')).toMatchObject({ status: 'failed', summary: REVIEW_CANCELLED });
	});
});

describe('posting the findings as one review', () => {
	test('postFindings leaves findingsReview posted', async () => {
		const api = createSampleApi();
		const review = await api.postFindings('sample-214');

		expect(review.findingsReview).toMatchObject({
			state: 'posted',
			url: 'https://github.com/acme/api/pull/214#findings-review'
		});

		expect(Object.keys(review.findingComments ?? {}).sort()).toEqual(['sample-f1', 'sample-f2', 'sample-f3']);
	});
});

describe('a stopped review that a person continues', () => {
	test('it starts over without the steps and claims of the run that was stopped', async () => {
		const api = createSampleApi();
		const review = await api.createReview({ repoId: 'sample-api', prNumber: 205 });
		const messages: ProgressMessage[] = [];

		api.follow(review.id, {
			onMessage: (message) => messages.push(message),
			onConnection: () => {},
			onStale: () => {}
		});

		jest.advanceTimersByTime(QUEUE_MS + TO_VERIFY_MS);
		await api.cancelReview(review.id);
		await api.continueReview(review.id);
		jest.advanceTimersByTime(QUEUE_MS);

		const shown = shownProgress(review.id, messages);

		expect(shown.stage).toBe('checkout');
		expect(Object.keys(shown.tasks)).toEqual(['fetch']);
		expect(shown.candidateCount).toBeUndefined();
	});
});
