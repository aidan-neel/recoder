'use client';

import { useMemo } from 'react';
import { useStore } from 'zustand';
import { useShallow } from 'zustand/react/shallow';

import { useApi, useListStore } from '../api/client';
import { useWatchList } from '../pulls/use-rows';
import { recentChats } from './recent-chats';
import { recentReviews } from './recent-reviews';
import { sidebarLists, useSettleMarks } from './settle';
import type { ShellView } from './types';
import { useNow } from './use-now';

/** How often rows are checked for having rested long enough to settle, in ms. */
const SETTLE_TICK = 60_000;

/** What the sidebar shows: the account, the open pull request count, the recent reviews and chats, and the settled ones. */
export function useShell(): ShellView {
	useWatchList();

	const { base } = useApi();
	const { state } = useListStore();

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
			recent,
			settled,
			chats,
			loading: data.reviews === null && data.phase === 'loading'
		}),
		[data.account, data.openPulls, recent, settled, chats, data.reviews, data.phase]
	);
}
