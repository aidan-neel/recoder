import { afterEach, beforeEach, describe, expect, jest, test } from 'bun:test';
import { applyProgressMessage, emptyReviewProgress, REVIEW_CANCELLED, type ProgressMessage } from '@recoder/shared';

import { createSampleApi } from '../../src/lib/sample/sample-api';

/** Time enough for a started review to leave the queue. */
const QUEUE_MS = 1_000;

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
