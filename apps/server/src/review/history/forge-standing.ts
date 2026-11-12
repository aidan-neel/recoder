import type { ResolvedFinding, Review, ReviewFindingComment } from '@recoder/shared';
import { earlierReviews } from './history.js';

/** Where a finding of a review stands on the pull request, for the forge publisher. */
export interface FindingForgeStanding {
	/**
	 * The comment already posted for this defect, by this review or an earlier
	 * one of the pull request; null when none was. A finding carried or
	 * rechecked across pushes keeps its id, so its comment is found here and
	 * edited rather than posted again.
	 */
	posted: ReviewFindingComment | null;
	/** Set when this review closed the defect because new evidence shows it fixed (`Review.resolved`). */
	resolved: ResolvedFinding | null;
}

/**
 * Was this finding already posted, and is it resolved now? `findingId` is one
 * of the review's findings or one of its resolved findings.
 */
export async function findingForgeStanding(review: Review, findingId: string): Promise<FindingForgeStanding> {
	const resolved = review.resolved?.find((entry) => entry.finding.id === findingId) ?? null;

	for (const reviewed of [review, ...(await earlierReviews(review))]) {
		const posted = reviewed.findingComments?.[findingId];

		if (posted) return { posted, resolved };
	}

	return { posted: null, resolved };
}
