import type { Repo, ReviewListItem } from '@recoder/shared';

import type { StartedReview } from '../ask/types';
import type { PullRowStatus } from '../pulls/types';
import { isCancelled, reviewStatus, shortRepoName } from '../pulls/pull-rows';

/** What the app knows about the reviews and repositories, from the list it keeps. */
interface KnownReviews {
	reviews: readonly ReviewListItem[] | null;
	repos: Repo[] | null;
}

/** The card for a review a reply started, from the reviews the list has read; one the list has not read yet just began. */
export function startedReview(
	started: { id: string; prNumber: number },
	repoId: string,
	known: KnownReviews,
	href: string
): StartedReview {
	const review = known.reviews?.find((candidate) => candidate.id === started.id) ?? null;

	return {
		href,
		prNumber: started.prNumber,
		title: review?.prTitle ?? `Pull request #${started.prNumber}`,
		repo: shortRepoName(known.repos, repoId),
		status: cardStatus(review)
	};
}

/** Reviewing until the list has the review; then its state, with a stopped review saying nothing. */
function cardStatus(review: ReviewListItem | null): PullRowStatus {
	if (!review) return { kind: 'reviewing' };
	if (isCancelled(review)) return { kind: 'not-reviewed' };

	return reviewStatus(review) ?? { kind: 'reviewed' };
}
