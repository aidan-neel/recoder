'use client';

import { useMemo } from 'react';
import { useStore } from 'zustand';
import { useShallow } from 'zustand/react/shallow';

import { useApi, useListStore } from '../api/client';
import { highBugs } from '../pulls/high-bugs';
import { shortRepoName } from '../pulls/pull-rows';
import { useRowEntries, useWatchList, type RowEntry } from '../pulls/use-rows';
import { recentChats } from './recent-chats';
import { recentReviews } from './recent-reviews';
import { repoHref } from './routes';
import { sidebarLists, useSettleMarks } from './settle';
import type { ShellView } from './types';
import { useNow } from './use-now';

/** How often rows are checked for having rested long enough to settle, in ms. */
const SETTLE_TICK = 60_000;

/** Each repository's open pull requests and the open high-severity bugs across them, by repository id. */
function repoCounts(entries: readonly RowEntry[]): ReadonlyMap<string, { open: number; highBugs: number }> {
	const counts = new Map<string, { open: number; highBugs: number }>();

	for (const entry of entries) {
		const id = entry.listed.item.repoId;
		const count = counts.get(id) ?? { open: 0, highBugs: 0 };

		counts.set(id, { open: count.open + 1, highBugs: count.highBugs + highBugs(entry) });
	}

	return counts;
}

/** What the sidebar shows: the account, the open pull request count, the tracked repositories, the recent reviews and chats, and the settled ones. */
export function useShell(): ShellView {
	useWatchList();

	const { base } = useApi();
	const { state } = useListStore();
	const entries = useRowEntries();

	const data = useStore(
		state,
		useShallow((current) => ({
			account: current.account,
			openPulls: current.list?.items.length ?? null,
			reviews: current.reviews,
			chats: current.chats,
			repos: current.repos,
			phase: current.phase
		}))
	);

	const marks = useSettleMarks((current) => current.marks);
	const now = useNow(SETTLE_TICK);

	const reviews = useMemo(
		() => (data.reviews ? recentReviews(data.reviews, data.repos, base) : { open: [], ended: [] }),
		[data.reviews, data.repos, base]
	);

	const counts = useMemo(() => repoCounts(entries), [entries]);

	const repos = useMemo(
		() =>
			(data.repos ?? [])
				.map((repo) => ({
					id: repo.id,
					name: shortRepoName(data.repos, repo.id),
					href: repoHref(base, repo.id),
					provider: repo.provider,
					open: counts.get(repo.id)?.open ?? 0,
					highBugs: counts.get(repo.id)?.highBugs ?? 0
				}))
				.sort(byName),
		[data.repos, base, counts]
	);

	const allChats = useMemo(
		() => (data.chats ? recentChats(data.chats, data.repos, base) : []),
		[data.chats, data.repos, base]
	);

	const { recent, settled, chats } = useMemo(
		() => sidebarLists({ ...reviews, chats: allChats }, marks, now),
		[reviews, allChats, marks, now]
	);

	return useMemo(
		() => ({
			account: data.account,
			openPulls: data.openPulls,
			repos,
			recent,
			settled,
			chats,
			loading: data.reviews === null && data.phase === 'loading'
		}),
		[data.account, data.openPulls, repos, recent, settled, chats, data.reviews, data.phase]
	);
}

/**
 * Repository names in order, case aside. Plain comparison, since names are ASCII paths: `localeCompare` sets up a
 * collator on first use, about 4 ms of the first paint.
 */
function byName(a: { name: string }, b: { name: string }): number {
	const left = a.name.toLowerCase();
	const right = b.name.toLowerCase();

	if (left === right) return 0;

	return left < right ? -1 : 1;
}
