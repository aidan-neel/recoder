'use client';

import { useMemo } from 'react';
import { useStore } from 'zustand';
import { useShallow } from 'zustand/react/shallow';

import { useApi, useListStore } from '../api/client';
import { useWatchList } from '../pulls/use-rows';
import { recentChats } from './recent-chats';
import { recentReviews } from './recent-reviews';
import type { ShellView } from './types';

/** What the sidebar shows: the account, the open pull request count, the recent reviews and the newest chats. */
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

	const { recent, settled } = useMemo(
		() => (data.reviews ? recentReviews(data.reviews, data.repos, base) : { recent: [], settled: [] }),
		[data.reviews, data.repos, base]
	);

	const chats = useMemo(
		() => (data.chats ? recentChats(data.chats, data.repos, base) : []),
		[data.chats, data.repos, base]
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
