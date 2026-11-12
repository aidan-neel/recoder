'use client';

import { shortAge, type ReviewListItem } from '@recoder/shared';
import { GitPullRequest } from 'lucide-react';
import { useEffect, useMemo } from 'react';

import { useConnections } from '@/lib/connections/connections-store';
import { pullRef, pullTitle } from '@/lib/shell/format';
import { itemScore } from '@/lib/shell/palette-filter';
import { repoFromLink } from '@/lib/shell/pull-ref';
import { refreshReviewIndex, useReviewIndex } from '@/lib/shell/review-index';
import type { PaletteItem } from '@/lib/shell/shell-store';

import { RunningIcon } from './palette-items';

/** With nothing typed, the group shows the newest few; the rest wait for a search, so the palette opens light. */
const NEWEST_ROWS = 8;

/** A search shows at most this many matching reviews, best match first. */
const MATCH_ROWS = 30;

/** Each status's icon color in the palette. */
const TONE: Record<ReviewListItem['status'], string> = {
	draft: 'var(--text-muted)',
	queued: 'var(--sev-medium)',
	running: 'var(--sev-medium)',
	passed: 'var(--ok)',
	failed: 'var(--danger)'
};

/** The repository a review belongs to: its tracked name, or the owner and name in its link when it is no longer tracked. */
function repoOf(review: ReviewListItem, names: Map<string, string>): string {
	return names.get(review.repoId) ?? (review.prUrl ? repoFromLink(review.prUrl) : null) ?? 'review';
}

/** One review as a palette row, newest first in its group. */
function reviewItem(review: ReviewListItem, names: Map<string, string>, open: (id: string) => void): PaletteItem {
	const repo = repoOf(review, names);
	const running = review.status === 'queued' || review.status === 'running';
	const age = shortAge(review.createdAt);

	return {
		id: `review:${review.id}`,
		group: 'Reviews',
		label: pullTitle(review.prTitle, review.prNumber),
		detail: `${pullRef(repo, review.prNumber)}${age ? ` · ${age}` : ''}`,
		keywords: `${repo} ${review.prNumber} ${review.status}`,
		icon: running ? RunningIcon : GitPullRequest,
		tone: TONE[review.status],
		run: () => open(review.id)
	};
}

/** Every review, newest first. */
function newestFirst(reviews: ReviewListItem[] | null): ReviewListItem[] {
	return (reviews ?? [])
		.map((review) => ({ review, at: Date.parse(review.createdAt) }))
		.sort((a, b) => b.at - a.at)
		.map((row) => row.review);
}

/**
 * The rows the group shows for `search`: with nothing typed, the newest few,
 * built alone, so opening the palette never builds a row per review; a search
 * scores them all and keeps the best matches.
 */
function shownRows(reviews: ReviewListItem[], search: string, toItem: (review: ReviewListItem) => PaletteItem) {
	if (!search.trim()) return reviews.slice(0, NEWEST_ROWS).map(toItem);

	return reviews
		.map(toItem)
		.map((item) => ({ item, score: itemScore(item, search) }))
		.filter((row) => row.score > 0)
		.sort((a, b) => b.score - a.score)
		.slice(0, MATCH_ROWS)
		.map((row) => row.item);
}

/** Reads the review list and the repository names again when they are stale. Resolves once the list read settles. */
function refresh(force = false): Promise<void> {
	if (force || !useConnections.getState().repos) void useConnections.getState().loadRepos();

	return refreshReviewIndex(force);
}

/** Reads the list again from Try again; rejects when it still fails, so the button shows its failure face. */
async function retry(): Promise<void> {
	await refresh(true);

	if (useReviewIndex.getState().status === 'failed') throw new Error('The review list did not load.');
}

/** The Reviews group as the palette shows it: its rows, and whether the first read is out or failed. */
export interface RecentReviews {
	items: PaletteItem[];
	/** True while the very first read is out: the palette holds two placeholder rows. */
	loading: boolean;
	/** True when the first read failed and no list is here: the palette says so and offers Try again. */
	failed: boolean;
	retry: () => Promise<void>;
}

/**
 * The reviews the server keeps, newest first: reviews of merged or closed
 * pull requests, of repositories no longer tracked, and older reviews a newer
 * one replaced. With nothing typed it shows the newest few; a search reaches
 * them all. The list is kept for the visit, so each open paints the last one
 * at once and reads it again in the background once it is a minute old.
 * `skip` holds the reviews the palette already lists in other rows.
 */
export function useRecentReviews(
	open: boolean,
	search: string,
	skip: Set<string>,
	go: (id: string) => void
): RecentReviews {
	const reviews = useReviewIndex((state) => state.reviews);
	const status = useReviewIndex((state) => state.status);
	const repos = useConnections((state) => state.repos);

	useEffect(() => {
		if (open) void refresh();
	}, [open]);

	const sorted = useMemo(() => newestFirst(reviews), [reviews]);
	const names = new Map((repos ?? []).map((repo) => [repo.id, repo.name]));
	const unlisted = sorted.filter((review) => !skip.has(review.id));

	return {
		items: shownRows(unlisted, search, (review) => reviewItem(review, names, go)),
		loading: !reviews && (status === 'loading' || status === 'idle'),
		failed: !reviews && status === 'failed',
		retry
	};
}
