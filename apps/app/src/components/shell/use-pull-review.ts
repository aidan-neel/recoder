'use client';

import type { Repo } from '@recoder/shared';
import { GitPullRequestArrow, Plug } from 'lucide-react';
import { useState } from 'react';

import { ApiError, failureText, OFFLINE_TEXT } from '@/lib/api/http';
import { reviewsApi } from '@/lib/api/reviews';
import { useConnections } from '@/lib/connections/connections-store';
import { pullRef } from '@/lib/shell/format';
import { errorToast } from '@/lib/shell/notify';
import { parsePullRef, reposFor, type PullRef } from '@/lib/shell/pull-ref';
import { useShell, type PaletteItem } from '@/lib/shell/shell-store';

import { RunningIcon } from './palette-items';

const GROUP = 'Review a pull request';

/** What the list says when it has no row to offer: a hint while nothing is typed, else that nothing matched. */
function emptyText(search: string, offline: boolean): string {
	if (offline) return OFFLINE_TEXT;

	return search.trim() ? 'No pull request matches.' : 'Type 12, or api#12 to pick the repository.';
}

/**
 * The way out when the pull request cannot belong to a tracked repository:
 * nothing is tracked yet, or the link or name points at one that is not.
 */
function trackItem(ref: PullRef | null, repos: Repo[]): PaletteItem[] {
	const named = ref?.address ?? ref?.name ?? null;
	const untracked = ref !== null && named !== null && reposFor(ref, repos).length === 0;

	if (repos.length > 0 && !untracked) return [];

	return [
		{
			id: 'track-repo',
			group: GROUP,
			label: 'Track a repository',
			detail: named ? `${named} isn’t tracked` : undefined,
			keywords: 'settings connections',
			icon: Plug,
			run: () => useShell.getState().navigate('/settings/connections')
		}
	];
}

/**
 * The palette's pull request mode, for a pull request the queue does not
 * list: a closed one, or one the list has not loaded yet. The person pastes a
 * link or types `#12` (`api#12` to pick a repository); each tracked repository
 * it can belong to becomes a row. Choosing one fetches the pull request and
 * starts its review, with a spinner in the row until the server answers (the
 * row keeps its text, so it stays highlighted); then the palette closes and
 * the review opens. A pasted link works from the main list too.
 */
export function usePullReview(open: boolean, go: (id: string) => void) {
	const [active, setActive] = useState(false);
	const [pending, setPending] = useState<string | null>(null);
	const [wasOpen, setWasOpen] = useState(open);
	const repos = useConnections((state) => state.repos);
	const offline = useConnections((state) => state.reposStatus === 'offline' && !state.repos);

	if (wasOpen !== open) {
		setWasOpen(open);

		if (!open) setActive(false);
	}

	async function review(repo: Repo, number: number, id: string): Promise<void> {
		if (pending) return;

		setPending(id);

		try {
			const pull = await reviewsApi.pull(repo.id, number);
			const started = await reviewsApi.start(repo.id, pull);

			go(started.id);
		} catch (error) {
			const action = error instanceof ApiError ? error.action : undefined;

			errorToast(`Couldn’t review ${pullRef(repo.name, number)}`, failureText(error), action);
		} finally {
			setPending(null);
		}
	}

	/**
	 * One row per tracked repository the typed reference can belong to, or a
	 * row that leads to tracking one. In the main list, only a pasted link counts.
	 */
	function items(search: string): PaletteItem[] {
		const ref = parsePullRef(search);

		const track = active && repos ? trackItem(ref, repos) : [];

		if (track.length > 0) return track;

		if (!ref || (!active && !ref.address)) return [];

		return reposFor(ref, repos ?? []).map((repo) => {
			const id = `pull:${repo.id}#${ref.number}`;

			return {
				id,
				group: GROUP,
				label: `Review ${pullRef(repo.name, ref.number)}`,
				detail: repo.name,
				keywords: search.trim(),
				icon: pending === id ? RunningIcon : GitPullRequestArrow,
				keepOpen: true,
				run: () => void review(repo, ref.number, id)
			};
		});
	}

	/** The action that turns the mode on, for the palette's Actions group. */
	const action: PaletteItem = {
		id: 'review-pull',
		group: 'Actions',
		label: 'Review a pull request…',
		keywords: 'start new link url number closed merged',
		icon: GitPullRequestArrow,
		keepOpen: true,
		run: () => {
			setActive(true);
			void useConnections.getState().loadRepos();
		}
	};

	return {
		active,
		action,
		items,
		/** Back to the main list, as Backspace in an empty field does. */
		leave: () => setActive(false),
		empty: (search: string) => emptyText(search, offline)
	};
}
