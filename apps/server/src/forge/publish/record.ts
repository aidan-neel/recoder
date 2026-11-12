import type { Review, ReviewFindingComment, ReviewPullComment } from '@recoder/shared';
import { db } from '../../store';

/** Every other review of the same pull request, in no order. */
export async function otherPullReviews(review: Review): Promise<Review[]> {
	return (await db.reviews.list()).filter(
		(other) => other.id !== review.id && other.repoId === review.repoId && other.prNumber === review.prNumber
	);
}

/** What a comment write changes about its record: everything but the stamp, which the save sets. */
type CommentStatePatch = Partial<Omit<ReviewPullComment, 'updatedAt'>>;

/**
 * Saves what Recoder posted on the pull request onto the review, so edits
 * survive a restart and the page can link to it. Leaves the review's own
 * `updatedAt` alone: a comment write is not a change to the review.
 */
async function save(reviewId: string, patch: (review: Review) => Partial<Review>): Promise<Review | undefined> {
	return db.reviews.update(reviewId, (current) => (current ? { ...current, ...patch(current) } : undefined));
}

/** `patch` merged over a comment record, stamped now; an `error` key set to undefined clears it. */
function mergedState(current: ReviewPullComment | undefined, patch: CommentStatePatch): ReviewPullComment {
	const next: ReviewPullComment = { state: 'posting', ...current, ...patch, updatedAt: new Date().toISOString() };

	if (next.error === undefined) delete next.error;

	return next;
}

/** Merge `patch` into the review's summary comment record. */
export async function savePullComment(reviewId: string, patch: CommentStatePatch): Promise<Review | undefined> {
	return await save(reviewId, (review) => ({ pullComment: mergedState(review.pullComment, patch) }));
}

export async function saveFindingComment(
	reviewId: string,
	findingId: string,
	comment: ReviewFindingComment
): Promise<Review | undefined> {
	return await save(reviewId, (review) => ({ findingComments: { ...review.findingComments, [findingId]: comment } }));
}

/** What one findings review submission leaves on its review. */
interface FindingsReviewOutcome {
	record: CommentStatePatch;
	/** The finding comments it posted or found, by finding id. */
	comments: Record<string, ReviewFindingComment>;
	/** Fingerprints of the findings its summary showed in full. */
	summarized: readonly string[];
}

/** Merge the outcome into the findings review's record, finding comments and summarized fingerprints, in one write. */
export async function saveFindingsReview(
	reviewId: string,
	outcome: FindingsReviewOutcome
): Promise<Review | undefined> {
	return await save(reviewId, (review) => ({
		findingsReview: mergedState(review.findingsReview, outcome.record),
		findingComments: { ...review.findingComments, ...outcome.comments },
		...withSummarized(review, outcome.summarized)
	}));
}

function withSummarized(review: Review, fingerprints: readonly string[]): Pick<Review, 'summarizedFindings'> {
	if (!fingerprints.length) return {};

	return { summarizedFindings: [...new Set([...(review.summarizedFindings ?? []), ...fingerprints])] };
}
