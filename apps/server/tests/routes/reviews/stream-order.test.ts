import { expect, spyOn, test } from 'bun:test';
import { localApp as app } from '../../helpers/local-app';
import { db } from '../../../src/store';
import { clearReviewEvents, emitReviewEvent, flushReviewEvents } from '../../../src/review/session/events';
import { testReview } from '../../helpers/review';

function messages(reader: ReadableStreamDefaultReader<Uint8Array>) {
	let pending = '';
	const decoder = new TextDecoder();

	return async () => {
		while (!pending.includes('\n\n')) {
			const result = await reader.read();

			if (result.done) throw new Error('The event stream ended before the next message.');
			pending += decoder.decode(result.value, { stream: true });
		}

		const end = pending.indexOf('\n\n');
		const raw = pending.slice(0, end);

		pending = pending.slice(end + 2);

		return JSON.parse(raw.replace(/^data: */, ''));
	};
}

async function openReviewStream() {
	const review = testReview();

	await db.reviews.set(review);

	const response = await app.request(`/api/reviews/${review.id}/events`);
	const reader = response.body!.getReader();
	const next = messages(reader);

	expect(await next()).toMatchObject({ type: 'snapshot' });

	return { review, reader, next };
}

test('slow subscriber reads cannot reorder live review events', async () => {
	const { review, reader, next } = await openReviewStream();

	const gate = Promise.withResolvers<void>();
	const original = db.reviews.get;
	let first = true;

	const read = spyOn(db.reviews, 'get').mockImplementation(async (id) => {
		if (first) {
			first = false;
			await gate.promise;
		}

		return original(id);
	});

	try {
		emitReviewEvent(review.id, { type: 'log', message: 'first' });
		emitReviewEvent(review.id, { type: 'log', message: 'second' });
		await flushReviewEvents(review.id);
		gate.resolve();
		expect(await next()).toMatchObject({ message: 'first' });
		expect(await next()).toMatchObject({ message: 'second' });
	} finally {
		gate.resolve();
		read.mockRestore();
		await reader.cancel();
		await db.reviews.delete(review.id);
		await clearReviewEvents(review.id);
	}
});

test('live events send the review when its status changes and still send a snapshot on completion', async () => {
	const { review, reader, next } = await openReviewStream();

	try {
		emitReviewEvent(review.id, { type: 'log', message: 'Unchanged' });
		expect(await next()).not.toHaveProperty('review');

		await db.reviews.update(review.id, (current) => ({ ...current!, status: 'failed' }));
		emitReviewEvent(review.id, { type: 'log', message: 'Status changed' });
		expect(await next()).toMatchObject({ message: 'Status changed', review: { id: review.id, status: 'failed' } });

		emitReviewEvent(review.id, { type: 'error', message: 'Finished' });

		expect(await next()).toMatchObject({
			type: 'error',
			review: { id: review.id, status: 'failed' },
			snapshot: { sequence: 3 }
		});
	} finally {
		await reader.cancel();
		await db.reviews.delete(review.id);
		await clearReviewEvents(review.id);
	}
});

test('a subscriber database failure closes its stream without stopping event persistence', async () => {
	const { review, reader } = await openReviewStream();

	const read = spyOn(db.reviews, 'get').mockRejectedValue(new Error('subscriber read failed'));
	const quiet = spyOn(console, 'error').mockImplementation(() => {});

	try {
		emitReviewEvent(review.id, { type: 'log', message: 'still persisted' });
		await flushReviewEvents(review.id);

		const closed = await reader.read().catch(() => ({ done: true }));

		expect(closed.done).toBe(true);
	} finally {
		read.mockRestore();
		quiet.mockRestore();
		await reader.cancel().catch(() => undefined);
		await db.reviews.delete(review.id);
		await clearReviewEvents(review.id);
	}
});
