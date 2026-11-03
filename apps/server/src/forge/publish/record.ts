import type { Review, ReviewFindingComment, ReviewPullComment } from '@recoder/shared';
import { db } from '../../store';

/**
 * Saves what Recoder posted on the pull request onto the review, so edits
 * survive a restart and the page can link to it. Leaves the review's own
 * `updatedAt` alone: a comment write is not a change to the review.
 */
function save(reviewId: string, patch: (review: Review) => Partial<Review>): Review | undefined {
	const current = db.reviews.get(reviewId);

	if (!current) return undefined;

	return db.reviews.set({ ...current, ...patch(current) });
}

/** Merge `patch` into the review's summary comment record; an `error` key set to undefined clears it. */
export function savePullComment(
	reviewId: string,
	patch: Partial<Omit<ReviewPullComment, 'updatedAt'>>
): Review | undefined {
	return save(reviewId, (review) => {
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

export function saveFindingComment(
	reviewId: string,
	findingId: string,
	comment: ReviewFindingComment
): Review | undefined {
	return save(reviewId, (review) => ({ findingComments: { ...review.findingComments, [findingId]: comment } }));
}
