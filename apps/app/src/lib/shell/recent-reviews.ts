import { latestReviews, type Repo, type ReviewListItem } from '@recoder/shared';

import { isCancelled, openCounts, shortRepoName } from '../pulls/pull-rows';
import { plural, pullTitle } from './format';
import { pullHref } from './routes';
import type { RecentReview } from './types';

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

/** The newest review of each pull request, newest first; draft sessions are not reviews and are left out. */
export function recentReviews(reviews: ReviewListItem[], repos: Repo[] | null, base: string): RecentReview[] {
	return [...latestReviews(reviews).values()]
		.filter((review) => review.status !== 'draft')
		.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
		.slice(0, RECENT_LIMIT)
		.map((review) => ({
			reviewId: review.id,
			href: pullHref(base, review.repoId, review.prNumber, 'bugs'),
			title: pullTitle(review.prTitle, review.prNumber),
			repoName: shortRepoName(repos, review.repoId),
			number: review.prNumber,
			...standing(review)
		}));
}
