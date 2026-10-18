'use client';

import { shortAge, type Review } from '@recoder/shared';
import { GitPullRequest } from 'lucide-react';
import { useEffect, useState } from 'react';

import { reviewsApi } from '@/lib/api/reviews';
import { useConnections } from '@/lib/connections/connections-store';
import { pullRef, pullTitle } from '@/lib/shell/format';
import { repoFromLink } from '@/lib/shell/pull-ref';
import type { PaletteItem } from '@/lib/shell/shell-store';

import { RunningIcon } from './palette-items';

/** Each status's icon color in the palette. */
const TONE: Record<Review['status'], string> = {
	draft: 'var(--text-muted)',
	queued: 'var(--sev-medium)',
	running: 'var(--sev-medium)',
	passed: 'var(--ok)',
	failed: 'var(--danger)'
};

/** The repository a review belongs to: its tracked name, or the owner and name in its link when it is no longer tracked. */
function repoOf(review: Review, names: Map<string, string>): string {
	return names.get(review.repoId) ?? (review.prUrl ? repoFromLink(review.prUrl) : null) ?? 'review';
}

/** One review as a palette row, newest first in its group. */
function reviewItem(review: Review, names: Map<string, string>, open: (id: string) => void): PaletteItem {
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

/**
 * Every review the server keeps, newest first, read each time the palette
 * opens: reviews of merged or closed pull requests, of repositories no longer
 * tracked, and older reviews a newer one replaced. `skip` holds the reviews
 * the palette already lists in other rows.
 */
export function useRecentReviews(open: boolean, skip: Set<string>, go: (id: string) => void): PaletteItem[] {
	const [reviews, setReviews] = useState<Review[]>([]);
	const repos = useConnections((state) => state.repos);

	useEffect(() => {
		if (!open) return;

		let live = true;

		reviewsApi.reviews().then(
			(list) => live && setReviews(list),
			() => {}
		);

		void useConnections.getState().loadRepos();

		return () => {
			live = false;
		};
	}, [open]);

	const names = new Map((repos ?? []).map((repo) => [repo.id, repo.name]));

	return reviews
		.filter((review) => !skip.has(review.id))
		.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
		.map((review) => reviewItem(review, names, go));
}
