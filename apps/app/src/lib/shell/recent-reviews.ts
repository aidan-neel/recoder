import { latestReviews, type Repo, type ReviewListItem } from '@recoder/shared';

import { isCancelled, isConnectedRepo, openCounts, repoForge, shortRepoName } from '../pulls/pull-rows';
import { plural, pullTitle } from './format';
import { pullHref } from './routes';
import type { RecentReview, SettledReview } from './types';

/** How many reviews the sidebar lists. */
const RECENT_LIMIT = 8;

/** Where a review stands for the sidebar, in a word or two. */
function standing(review: ReviewListItem): Pick<RecentReview, 'state' | 'label'> {
	if (review.status === 'queued') return { state: 'queued', label: 'Queued' };
	if (review.status === 'running') return { state: 'running', label: 'Reviewing' };
	if (isCancelled(review)) return { state: 'failed', label: 'Cancelled' };
	if (review.status === 'failed') return { state: 'failed', label: 'Failed' };

	const { bugs, suggestions } = openCounts(review);

	if (bugs > 0) return { state: 'bugs', label: plural(bugs, 'bug') };
	if (suggestions > 0) return { state: 'bugs', label: plural(suggestions, 'suggestion') };

	return { state: 'clean', label: 'No bugs' };
}

/** The sidebar's two lists of reviews. */
interface SidebarReviews {
	recent: RecentReview[];
	settled: SettledReview[];
}

/** How the pull request ended, or null while it is open or its state is not yet known. */
function outcomeOf(review: ReviewListItem): SettledReview['outcome'] | null {
	return review.pullState === 'merged' || review.pullState === 'closed' ? review.pullState : null;
}

function toRow(review: ReviewListItem, repos: Repo[] | null, base: string): RecentReview {
	return {
		reviewId: review.id,
		href: pullHref(base, review.repoId, review.prNumber, 'bugs'),
		repoId: review.repoId,
		title: pullTitle(review.prTitle, review.prNumber),
		repoName: shortRepoName(repos, review.repoId),
		repoForge: repoForge(repos, review.repoId),
		number: review.prNumber,
		updatedAt: review.updatedAt,
		...standing(review)
	};
}

/**
 * The newest review of each pull request in a connected repo, newest first;
 * draft sessions are not reviews and are left out. Reviews of pull requests
 * that were merged or closed go to `settled`; only the rest count against the
 * limit of `recent`.
 */
export function recentReviews(reviews: ReviewListItem[], repos: Repo[] | null, base: string): SidebarReviews {
	const newestFirst = [...latestReviews(reviews).values()]
		.filter((review) => review.status !== 'draft' && isConnectedRepo(repos, review.repoId))
		.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));

	return {
		recent: newestFirst
			.filter((review) => outcomeOf(review) === null)
			.slice(0, RECENT_LIMIT)
			.map((review) => toRow(review, repos, base)),
		settled: newestFirst.flatMap((review) => {
			const outcome = outcomeOf(review);

			return outcome ? [{ ...toRow(review, repos, base), outcome }] : [];
		})
	};
}
