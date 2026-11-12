import type { Finding, Review } from '@recoder/shared';
import { app } from '../../../src/app';
import { db, reviewDiffs } from '../../../src/store';
import { DIFF } from '../../review/pipeline/harness-fixtures';
import { testReview } from '../../helpers/review';

/** A review of `repo-1` holding `findings`, saved with the fixture diff, as the finding routes read it; `overrides` replace any field. */
export async function savedReview(findings: Finding[], overrides: Partial<Review> = {}) {
	const review = await db.reviews.set(testReview({ repoId: 'repo-1', findings, ...overrides }));

	await reviewDiffs.set(review.id, DIFF);

	return review;
}

/** One JSON request to the app. */
export const send = (path: string, method: string, body?: unknown) =>
	app.request(path, {
		method,
		headers: { 'content-type': 'application/json' },
		body: body === undefined ? undefined : JSON.stringify(body)
	});
