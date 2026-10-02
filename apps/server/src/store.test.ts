import { expect, test } from 'bun:test';
import { emptyReviewProgress } from '@recoder/shared';
import { closeStore, reviewProgress } from './store';

test('review progress written moments ago survives the store closing before its write-behind timer fires', () => {
	const id = crypto.randomUUID();
	reviewProgress.set({ ...emptyReviewProgress(id), sequence: 3, planSummary: 'two specialists' });
	// Nothing has reached SQLite yet; closing must flush, and a fresh handle must read it back.
	closeStore();
	expect(reviewProgress.get(id)).toMatchObject({ sequence: 3, planSummary: 'two specialists' });
	reviewProgress.delete(id);
	closeStore();
	expect(reviewProgress.get(id)).toBeUndefined();
});
