'use client';

import { useMemo } from 'react';
import { useStore } from 'zustand';
import { useShallow } from 'zustand/react/shallow';

import { useApi, useListStore } from '../api/client';
import { useWatchList } from '../pulls/use-rows';
import { recentReviews } from './recent-reviews';
import type { ShellView } from './types';

/** What the sidebar shows: the account, the open pull request count and the recent reviews. */
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
			repos: current.repos,
			phase: current.phase,
			offline: current.offline
		}))
	);

	const recent = useMemo(
		() => (data.reviews ? recentReviews(data.reviews, data.repos, base) : []),
		[data.reviews, data.repos, base]
	);

	return useMemo(
		() => ({
			account: data.account,
			openPulls: data.openPulls,
			recent,
			loading: data.reviews === null && data.phase === 'loading',
			offline: data.offline
		}),
		[data.account, data.openPulls, recent, data.reviews, data.phase, data.offline]
	);
}
