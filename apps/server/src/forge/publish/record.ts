import type { Review, ReviewFindingComment, ReviewPullComment } from '@recoder/shared';
import { db } from '../../store';

/**
 * Saves what Recoder posted on the pull request onto the review, so edits
 * survive a restart and the page can link to it. Leaves the review's own
 * `updatedAt` alone: a comment write is not a change to the review.
 */
async function save(reviewId: string, patch: (review: Review) => Partial<Review>): Promise<Review | undefined> {
	return db.reviews.update(reviewId, (current) => (current ? { ...current, ...patch(current) } : undefined));
}

/** Merge `patch` into the review's summary comment record; an `error` key set to undefined clears it. */
export async function savePullComment(
	reviewId: string,
	patch: Partial<Omit<ReviewPullComment, 'updatedAt'>>
): Promise<Review | undefined> {
	return await save(reviewId, (review) => {
		const next: ReviewPullComment = {
			state: 'posting',
			...review.pullComment,
			...patch,
			updatedAt: new Date().toISOString()
		};

		if (next.error === undefined) delete next.error;

		return { pullComment: next };
	});
}

export async function saveFindingComment(
	reviewId: string,
	findingId: string,
	comment: ReviewFindingComment
): Promise<Review | undefined> {
	return await save(reviewId, (review) => ({ findingComments: { ...review.findingComments, [findingId]: comment } }));
}
