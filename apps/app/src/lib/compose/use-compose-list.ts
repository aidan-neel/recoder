'use client';

import { useCallback, useMemo, useState } from 'react';
import { useStore } from 'zustand';
import { useShallow } from 'zustand/react/shallow';

import { useApi, useListStore } from '../api/client';
import { needsReview } from '../pulls/pull-rows';
import { narrowEntries, type RowEntry } from '../pulls/use-rows';
import { recentChats } from '../shell/recent-chats';
import { queryTerms } from '../shell/search';
import type { RecentChat } from '../shell/types';
import { isPaste } from './compose-target';
import type { ComposeList } from './types';

/** True when every word of the search is in the chat's title or its repository's name. */
function chatMatches(chat: RecentChat, terms: string[]): boolean {
	const text = `${chat.title} ${chat.repoName}`.toLowerCase();

	return terms.every((term) => text.includes(term));
}

/**
 * The lists over New's composer: the open pull requests in two groups, those
 * with no review at their head and those with one, and the newest chats, each
 * narrowed by the find text and the repository filter. `takeReference`
 * chooses the pull request a text names and says whether it did, so a link
 * pasted into the find field becomes the choice instead of a search.
 */
export function useComposeList(entries: RowEntry[], takeReference: (text: string) => boolean): ComposeList {
	const { base } = useApi();
	const { state } = useListStore();
	const [query, setQueryText] = useState('');
	const [chosenRepoId, setRepoId] = useState<string | null>(null);

	const { repos, chats, starting } = useStore(
		state,
		useShallow((data) => ({ repos: data.repos, chats: data.chats, starting: data.starting }))
	);

	const repoId = repos?.some((repo) => repo.id === chosenRepoId) ? chosenRepoId : null;
	const narrowed = useMemo(() => narrowEntries(entries, repoId, query), [entries, repoId, query]);

	const unreviewed = useMemo(
		() => narrowed.filter(({ listed, row }) => needsReview(listed) && !starting.has(row.key)).map(({ row }) => row),
		[narrowed, starting]
	);

	const reviewed = useMemo(
		() => narrowed.filter(({ listed }) => !needsReview(listed)).map(({ row }) => row),
		[narrowed]
	);

	const shownChats = useMemo(() => {
		const terms = queryTerms(query);

		return recentChats(chats ?? [], repos, base).filter(
			(chat) => (!repoId || chat.repoId === repoId) && chatMatches(chat, terms)
		);
	}, [chats, repos, base, repoId, query]);

	const setQuery = useCallback(
		(next: string) => {
			const chosen = isPaste(query, next) && takeReference(next);

			setQueryText(chosen ? '' : next);
		},
		[query, takeReference]
	);

	const settleQuery = useCallback(() => {
		if (takeReference(query)) setQueryText('');
	}, [query, takeReference]);

	return useMemo(
		() => ({
			query,
			setQuery,
			settleQuery,
			repoId,
			setRepoId,
			unreviewed,
			reviewed,
			chats: shownChats,
			chatsLoading: chats === null
		}),
		[query, setQuery, settleQuery, repoId, unreviewed, reviewed, shownChats, chats]
	);
}
