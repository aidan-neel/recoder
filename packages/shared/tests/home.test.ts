import { expect, test } from 'bun:test';
import { latestReviews } from '../src/home';
import type { Review } from '../src/review';

function review(id: string, status: Review['status'], updatedAt: string): Review {
	return { id, repoId: 'r1', prNumber: 88, status, updatedAt } as Review;
}

test('a real review outranks a newer empty draft', () => {
	const done = review('done', 'passed', '2026-09-22T09:00:00Z');
	const draft = review('draft', 'draft', '2026-09-22T18:00:00Z');

	expect(latestReviews([done, draft]).get('r1#88')?.id).toBe('done');
});
