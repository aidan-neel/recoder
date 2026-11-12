import { expect, test } from 'bun:test';
import { emptyReviewProgress, type ReviewProgress, type ReviewToolCall } from '@recoder/shared';
import { app } from '../../../src/app';
import { listenerCount } from '../../../src/review/session/events';
import { db, reviewProgress } from '../../../src/store';
import { testReview } from '../../helpers/review';

/** The first server-sent event on a review's stream (one `data:` line), parsed; the stream is closed after it. */
async function firstEvent(path: string): Promise<{ type: string; snapshot: ReviewProgress }> {
	const response = await app.request(path);
	const reader = response.body!.getReader();
	const decoder = new TextDecoder();
	let text = '';

	while (!text.includes('\n\n')) {
		const { value, done } = await reader.read();

		if (done) break;
		text += decoder.decode(value, { stream: true });
	}

	await reader.cancel();

	const frame = text.slice(0, text.indexOf('\n\n'));

	return JSON.parse(frame.slice(frame.indexOf('data:') + 'data:'.length));
}

test('a stream opened with tools=0 sends its snapshot without the tool calls, and the default keeps them', async () => {
	const review = await db.reviews.set(testReview({ status: 'running' }));
	const tool = { id: 'tool-1', command: 'bun test', status: 'done', exitCode: 0 } as ReviewToolCall;

	await reviewProgress.set({ ...emptyReviewProgress(review.id), sequence: 4, toolCalls: [tool] });

	const slim = await firstEvent(`/api/reviews/${review.id}/events?tools=0`);
	const full = await firstEvent(`/api/reviews/${review.id}/events`);

	expect(slim.type).toBe('snapshot');
	expect(slim.snapshot).not.toHaveProperty('toolCalls');
	expect(slim.snapshot.sequence).toBe(4);
	expect(full.snapshot.toolCalls).toEqual([tool]);

	await db.reviews.delete(review.id);
	await reviewProgress.delete(review.id);
});

test('a client that leaves ends its stream and releases the subscription', async () => {
	const review = await db.reviews.set(testReview({ status: 'running' }));
	const reader = (await app.request(`/api/reviews/${review.id}/events`)).body!.getReader();

	await reader.read();
	expect(listenerCount(review.id)).toBe(1);

	await reader.cancel();
	await Bun.sleep(5);
	expect(listenerCount(review.id)).toBe(0);

	await db.reviews.delete(review.id);
});
