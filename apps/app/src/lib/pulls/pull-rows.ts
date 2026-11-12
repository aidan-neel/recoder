import { REVIEW_CANCELLED, repoLabels, type PullListItem, type Repo, type ReviewListItem } from '@recoder/shared';

import { isOpenFinding } from '../api/reviews';
import { repoName } from '../shell/format';
import { pullHref } from '../shell/routes';
import type { PullFilter, PullRow, PullRowStatus } from './types';

/** A pull request of the list with the review the row should show: one just started here wins over the server's. */
export interface ListedPull {
	item: PullListItem;
	review: ReviewListItem | null;
}

/** The `<repoId>#<number>` key of a pull request, unique across repositories. */
export function pullKey(repoId: string, number: number): string {
	return `${repoId}#${number}`;
}

/** True while the review waits for or runs its pipeline. */
export function isReviewing(review: Pick<ReviewListItem, 'status'> | null): boolean {
	return review?.status === 'queued' || review?.status === 'running';
}

/** True for a failed review that a person stopped. */
export function isCancelled(review: Pick<ReviewListItem, 'status' | 'summary'>): boolean {
	return review.status === 'failed' && review.summary === REVIEW_CANCELLED;
}

/** Open findings by kind: quality findings are suggestions, the rest bugs. */
export function openCounts(review: Pick<ReviewListItem, 'findings'>): { bugs: number; suggestions: number } {
	const open = review.findings.filter(isOpenFinding);
	const suggestions = open.filter((finding) => finding.kind === 'quality').length;

	return { bugs: open.length - suggestions, suggestions };
}

/** True when a review was asked for and not cancelled: not a draft session, and not a run a person stopped. */
function isRealReview(review: ReviewListItem | null): review is ReviewListItem {
	return !!review && review.status !== 'draft' && !isCancelled(review);
}

/** The status of a review that ran or failed, when it decides the row; null to read the forge's state next. */
function reviewStatus(review: ReviewListItem | null): PullRowStatus | null {
	if (!review) return null;
	if (isReviewing(review)) return { kind: 'reviewing' };

	if (review.status === 'passed') {
		const counts = openCounts(review);

		if (counts.bugs + counts.suggestions > 0) return { kind: 'bugs', ...counts };
	}

	if (review.status === 'failed' && !isCancelled(review)) return { kind: 'review-failed' };

	return null;
}

/** What the row says about its pull request: the first rule that holds, most urgent first. */
export function rowStatus({ item, review }: ListedPull): PullRowStatus {
	const fromReview = reviewStatus(review);
	const { status, pull } = item;

	if (fromReview) return fromReview;
	if (status.mergeability === 'conflicts') return { kind: 'conflicts' };
	if (status.checks && status.checks.failed > 0) return { kind: 'checks-failing', failed: status.checks.failed };
	if (status.draft) return { kind: 'draft' };
	if (!isRealReview(review)) return { kind: 'not-reviewed' };
	if (review.headSha !== pull.headSha) return { kind: 'outdated' };
	if (status.mergeability === 'clean' && !status.checks?.pending) return { kind: 'ready' };

	return { kind: 'reviewed' };
}

/** True when no review runs, ran or waits at the pull request's current head. */
export function needsReview({ item, review }: ListedPull): boolean {
	if (!isRealReview(review) || review.status === 'failed') return true;

	return review.headSha !== item.pull.headSha;
}

/**
 * The repository's name for a row, from the tracked list: its short name, or
 * the label that tells it apart when another tracked repository has the same
 * short name. Its id until that list is known.
 */
export function shortRepoName(repos: Repo[] | null, repoId: string): string {
	const repo = repos?.find((candidate) => candidate.id === repoId);

	if (!repos || !repo) return repoId;

	const short = repoName(repo.name);
	const isShared = repos.some((other) => other.id !== repo.id && repoName(other.name) === short);

	return isShared ? (repoLabels(repos).get(repo.id) ?? repo.name) : short;
}

/** One row of the list. */
export function pullRow(listed: ListedPull, repos: Repo[] | null, base: string): PullRow {
	const { item, review } = listed;
	const { pull } = item;

	return {
		key: pullKey(item.repoId, pull.number),
		repoId: item.repoId,
		repoName: shortRepoName(repos, item.repoId),
		number: pull.number,
		title: pull.title,
		author: pull.author,
		activeAt: item.status.updatedAt,
		additions: pull.additions,
		deletions: pull.deletions,
		status: rowStatus(listed),
		reviewId: review?.id ?? null,
		href: pullHref(base, item.repoId, pull.number)
	};
}

/** Rows newest activity first. */
export function byActivity(a: PullRow, b: PullRow): number {
	return Date.parse(b.activeAt) - Date.parse(a.activeAt);
}

/** True when the row belongs under the filter. */
export function inFilter(filter: PullFilter, row: PullRow, listed: ListedPull): boolean {
	if (filter === 'needs-review') return needsReview(listed);
	if (filter === 'bugs') return row.status.kind === 'bugs';
	if (filter === 'ready') return row.status.kind === 'ready';

	return true;
}

/** True when every word of the search is in the row's title, author, repository or number. */
export function matchesQuery(row: PullRow, terms: string[]): boolean {
	const text = `${row.title} ${row.author} ${row.repoName} #${row.number}`.toLowerCase();

	return terms.every((term) => text.includes(term));
}
