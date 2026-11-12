import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { ReviewListItem } from '@recoder/shared';

import { refreshReviewIndex, useReviewIndex } from '../../src/lib/shell/review-index';

const realFetch = globalThis.fetch;

/** A review list row; only the id matters here. */
function review(id: string): ReviewListItem {
	return { id } as ReviewListItem;
}

/** Stubs `fetch` with `answer` and counts the calls. */
function stubFetch(answer: () => Promise<Response>): { calls: number } {
	const counter = { calls: 0 };

	globalThis.fetch = (() => {
		counter.calls++;

		return answer();
	}) as unknown as typeof fetch;

	return counter;
}

/** A JSON answer with the given status. */
function json(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

beforeEach(() => {
	useReviewIndex.setState({ reviews: null, status: 'idle', loadedAt: 0 });
});

afterEach(() => {
	globalThis.fetch = realFetch;
});

describe('refreshReviewIndex', () => {
	test('a list younger than a minute is not read again, and an older one is', async () => {
		const counter = stubFetch(() => Promise.resolve(json([review('a')])));

		await refreshReviewIndex();
		await refreshReviewIndex();

		expect(counter.calls).toBe(1);
		expect(useReviewIndex.getState().reviews?.map((item) => item.id)).toEqual(['a']);

		useReviewIndex.setState({ loadedAt: Date.now() - 61_000 });
		await refreshReviewIndex();

		expect(counter.calls).toBe(2);
	});

	test('reads started while one is out join it, across tasks', async () => {
		let answer: (response: Response) => void = () => {};
		const counter = stubFetch(() => new Promise<Response>((resolve) => (answer = resolve)));
		const first = refreshReviewIndex();

		await Promise.resolve();

		const second = refreshReviewIndex(true);

		answer(json([review('a')]));
		await Promise.all([first, second]);

		expect(counter.calls).toBe(1);
		expect(useReviewIndex.getState().status).toBe('ready');
	});

	test('a failed refresh keeps the list the palette already shows', async () => {
		useReviewIndex.setState({ reviews: [review('kept')], status: 'ready', loadedAt: 0 });
		stubFetch(() => Promise.resolve(json({ error: 'boom' }, 500)));

		await refreshReviewIndex();

		expect(useReviewIndex.getState().status).toBe('ready');
		expect(useReviewIndex.getState().reviews?.map((item) => item.id)).toEqual(['kept']);
	});

	test('Try again after a failed first read stays failed until it lands, so the notice holds its place', async () => {
		useReviewIndex.setState({ reviews: null, status: 'failed', loadedAt: 0 });

		let answer: (response: Response) => void = () => {};

		stubFetch(() => new Promise<Response>((resolve) => (answer = resolve)));

		const retry = refreshReviewIndex(true);

		expect(useReviewIndex.getState().status).toBe('failed');

		answer(json([review('a')]));
		await retry;

		expect(useReviewIndex.getState().status).toBe('ready');
	});
});
