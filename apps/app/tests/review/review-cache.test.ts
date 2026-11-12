import { afterEach, expect, test } from 'bun:test';
import { emptyReviewProgress } from '@recoder/shared';

import { cachedReview, forgetReview, rememberReview } from '../../src/lib/review/review-cache';
import { SAMPLE_REVIEW } from '../../src/lib/sample/sample-review';
import { memoryStorage } from '../fixtures';

const IDS = ['a', 'b', 'c', 'd', 'e', 'w', 'x', 'y', 'z'];

/** A copy of review `id` to keep, with live progress so a test can see whether it survives. */
function entry(id: string): Parameters<typeof rememberReview>[0] {
	return {
		review: { ...SAMPLE_REVIEW, id },
		files: [],
		pull: null,
		repoName: 'acme/api',
		checks: null,
		progress: emptyReviewProgress(id)
	};
}

afterEach(() => {
	for (const id of IDS) forgetReview(id);

	Reflect.deleteProperty(globalThis, 'sessionStorage');
	Reflect.deleteProperty(globalThis, 'requestIdleCallback');
});

/** Session storage that refuses to keep review `refused` and to remove anything, as a full or locked store can. */
function refusingStorage(refused: string): Storage {
	const store = memoryStorage();

	return {
		...store,
		setItem: (key, value) => {
			if (key.endsWith(`.${refused}`)) throw new DOMException('Full.', 'QuotaExceededError');

			store.setItem(key, value);
		},
		removeItem: () => {
			throw new DOMException('Locked.', 'SecurityError');
		},
		getItem: (key) => store.getItem(key)
	};
}

test('memory keeps the four most recent reviews, and reading one makes it recent again', () => {
	for (const id of ['a', 'b', 'c', 'd']) rememberReview(entry(id));

	cachedReview('a');
	rememberReview(entry('e'));

	expect(cachedReview('b')).toBeNull();
	expect(cachedReview('a')?.review.id).toBe('a');
});

test('a reload finds the two most recent pages without their progress, and never a review only read ahead', () => {
	Object.assign(globalThis, { sessionStorage: memoryStorage() });

	for (const id of ['a', 'b', 'c']) rememberReview(entry(id));
	for (const id of ['w', 'x', 'y', 'z']) rememberReview(entry(id), 'never');

	expect(cachedReview('a')).toBeNull();
	expect(cachedReview('b')).toMatchObject({ repoName: 'acme/api', progress: null });
	expect(cachedReview('c')?.review.id).toBe('c');
	expect(cachedReview('w')).toBeNull();
});

test('a copy storage refuses, even one it then cannot remove, leaves the copies after it reaching session storage', () => {
	const storage = refusingStorage('a');
	const idle: (() => void)[] = [];

	Object.assign(globalThis, { sessionStorage: storage, requestIdleCallback: (run: () => void) => idle.push(run) });

	rememberReview(entry('a'), 'idle');
	idle.shift()?.();
	rememberReview(entry('b'), 'idle');
	idle.shift()?.();

	expect(storage.getItem('recoder.review-cache.v1.a')).toBeNull();
	expect(storage.getItem('recoder.review-cache.v1.b')).not.toBeNull();
});
