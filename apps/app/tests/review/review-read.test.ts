import { afterEach, beforeEach, expect, test } from 'bun:test';
import type { Review } from '@recoder/shared';

import { cachedReview, forgetReview } from '../../src/lib/review/review-cache';
import { readReview } from '../../src/lib/review/review-read';
import { useReview } from '../../src/lib/review/review-store';
import { warmReview } from '../../src/lib/review/review-warm';
import { SAMPLE_DIFFS } from '../../src/lib/sample/sample-diff';
import { SAMPLE_REVIEW } from '../../src/lib/sample/sample-review';
import { flush, memoryStorage } from '../fixtures';
import { FakeEventSource } from './fake-event-source';

/** The status the fake server gives every review. */
let status: Review['status'] = 'passed';

/** Every path asked for, in order. */
const fetched: string[] = [];

/** False while the server has no diff for the review yet. */
let hasDiff = true;

/** Lets the server answer, so a test can act while reads are in flight. */
let release = () => {};

let stop = () => {};

function answer(path: string): Response {
	const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

	const review = /^\/api\/reviews\/([^/]+)$/.exec(path);

	if (review) return json({ ...SAMPLE_REVIEW, id: review[1], status });
	if (path.endsWith('/files')) return hasDiff ? json(SAMPLE_DIFFS) : json({ error: 'no diff yet' }, 404);
	if (path.endsWith('/checks')) return json({ ref: SAMPLE_REVIEW.headSha, checks: [] });

	return json([]);
}

beforeEach(() => {
	const held = new Promise<void>((resolve) => (release = resolve));

	fetched.length = 0;
	hasDiff = true;
	status = 'passed';

	Object.assign(globalThis, {
		EventSource: FakeEventSource,
		fetch: (input: string | URL) => {
			const path = new URL(String(input)).pathname;

			fetched.push(path);

			return held.then(() => answer(path));
		},
		localStorage: memoryStorage(),
		document: { visibilityState: 'visible', addEventListener: () => {}, removeEventListener: () => {} }
	});
});

afterEach(() => {
	stop();

	for (const id of ['rv-9', 'rv-10', 'rv-11']) forgetReview(id);
	Reflect.deleteProperty(globalThis, 'localStorage');
	Reflect.deleteProperty(globalThis, 'document');
});

/** How many times the server was asked for `path`. */
function asked(path: string): number {
	return fetched.filter((item) => item === path).length;
}

test('opening a review while its read ahead runs asks the server for the review and its diff once', async () => {
	const warm = warmReview('rv-9');

	await new Promise((resolve) => setTimeout(resolve, 1));
	stop = useReview.getState().load('rv-9');
	release();
	await warm;
	await flush();

	expect(useReview.getState().status).toBe('ready');
	expect(asked('/api/reviews/rv-9')).toBe(1);
	expect(asked('/api/reviews/rv-9/files')).toBe(1);
});

test('a diff the server has not made yet is not kept, so the page reads it itself', async () => {
	hasDiff = false;
	release();
	await readReview('rv-10');

	expect(cachedReview('rv-10')).toBeNull();
});

test('opening a running review just after a read found no diff yet takes that read instead of asking again', async () => {
	hasDiff = false;
	status = 'running';
	release();
	await readReview('rv-11');
	stop = useReview.getState().load('rv-11');
	await flush();

	expect(useReview.getState().status).toBe('ready');
	expect(asked('/api/reviews/rv-11')).toBe(1);
	expect(asked('/api/reviews/rv-11/files')).toBe(1);
});
