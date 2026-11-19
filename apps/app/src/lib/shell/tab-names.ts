'use client';

import { useMemo } from 'react';
import { useStore } from 'zustand';
import { useShallow } from 'zustand/react/shallow';

import { useApi, useListStore } from '../api/client';
import { shortRepoName } from '../pulls/pull-rows';
import { useRowEntries } from '../pulls/use-rows';
import { recentChats } from './recent-chats';
import { recentReviews } from './recent-reviews';
import { repoHref } from './routes';
import { pathOf } from './tabs';
import type { RecentReview } from './types';

/** What a window tab knows of the page it shows beyond its address: the page's own name, and a review's state. */
export interface TabName {
	label: string;
	review: RecentReview['state'] | null;
}

/**
 * The names the app already holds for its pages, by path: each open pull request's title, each reviewed pull
 * request's title and its review's state, each chat's title and each repository's name. A tab whose page is none of
 * these is named for its screen.
 */
export function useTabNames(): ReadonlyMap<string, TabName> {
	const { base } = useApi();
	const { state } = useListStore();
	const entries = useRowEntries();

	const data = useStore(
		state,
		useShallow((current) => ({ reviews: current.reviews, chats: current.chats, repos: current.repos }))
	);

	return useMemo(() => {
		const names = new Map<string, TabName>();

		for (const { row } of entries) names.set(pathOf(row.href), { label: row.title, review: null });

		for (const repo of data.repos ?? [])
			names.set(repoHref(base, repo.id), { label: shortRepoName(data.repos, repo.id), review: null });

		for (const chat of data.chats ? recentChats(data.chats, data.repos, base) : [])
			names.set(pathOf(chat.href), { label: chat.title, review: null });

		const reviews = data.reviews ? recentReviews(data.reviews, data.repos, base) : { open: [], ended: [] };

		for (const review of [...reviews.ended, ...reviews.open])
			names.set(pathOf(review.href), { label: review.title, review: review.state });

		return names;
	}, [entries, data, base]);
}
