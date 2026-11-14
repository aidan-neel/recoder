'use client';

import { useCallback, useMemo } from 'react';
import { useStore } from 'zustand';
import { useShallow } from 'zustand/react/shallow';

import { useListStore } from '../api/client';
import { queryTerms } from '../shell/search';
import { inFilter, matchesQuery, shortRepoName } from './pull-rows';
import type { PullFilter, PullListView, PullRow, RepoOption } from './types';
import { useRowEntries, useWatchList, type RowEntry } from './use-rows';

const FILTERS: PullFilter[] = ['all', 'needs-review', 'bugs', 'ready'];

/** How many of the entries each filter holds. */
function filterCounts(entries: RowEntry[]): Record<PullFilter, number> {
	const counts = { all: 0, 'needs-review': 0, bugs: 0, ready: 0 };

	for (const { listed, row } of entries) {
		for (const filter of FILTERS) {
			if (inFilter(filter, row, listed)) counts[filter] += 1;
		}
	}

	return counts;
}

/** The pull request list screen: rows after the repository filter, the search text and the status filter. */
export function usePullList(): PullListView {
	useWatchList();

	const list = useListStore();
	const entries = useRowEntries();

	const data = useStore(
		list.state,
		useShallow((state) => ({
			phase: state.phase,
			repos: state.repos,
			pullList: state.list,
			error: state.error,
			offline: state.offline,
			refreshing: state.refreshing,
			starting: state.starting,
			filter: state.filter,
			repoId: state.repoId,
			query: state.query
		}))
	);

	const { repos, pullList, filter, repoId, query } = data;

	const narrowed = useMemo(() => {
		const terms = queryTerms(query);

		return entries.filter(({ row }) => (!repoId || row.repoId === repoId) && matchesQuery(row, terms));
	}, [entries, repoId, query]);

	const rows = useMemo(
		() => narrowed.filter(({ listed, row }) => inFilter(filter, row, listed)).map(({ row }) => row),
		[narrowed, filter]
	);

	const counts = useMemo(() => filterCounts(narrowed), [narrowed]);

	const repoOptions = useMemo<RepoOption[]>(
		() => (repos ?? []).map((repo) => ({ id: repo.id, name: repo.name, provider: repo.provider })),
		[repos]
	);

	const failures = useMemo(
		() =>
			(pullList?.failures ?? []).map((failure) => ({
				repoName: shortRepoName(repos, failure.repoId),
				error: failure.error
			})),
		[pullList, repos]
	);

	const more = useStore(list.state, (state) => state.more);
	const available = Object.keys(more.cursors).some((id) => repoId === null || id === repoId);
	const loadMore = useCallback(() => void list.loadMore(repoId), [list, repoId]);

	const morePages = useMemo(
		() => ({ available, loading: more.loading, error: more.error, load: loadMore }),
		[available, more.loading, more.error, loadMore]
	);

	const setFilter = useCallback((next: PullFilter) => list.state.setState({ filter: next }), [list]);
	const setRepoId = useCallback((next: string | null) => list.state.setState({ repoId: next }), [list]);
	const setQuery = useCallback((next: string) => list.state.setState({ query: next }), [list]);

	const review = useCallback(
		async (row: PullRow) => {
			await list.start({ repoId: row.repoId, number: row.number, title: row.title });
		},
		[list]
	);

	return useMemo(
		() => ({
			phase: data.phase,
			rows,
			counts,
			filter,
			setFilter,
			repos: repoOptions,
			repoId,
			setRepoId,
			query,
			setQuery,
			failures,
			more: morePages,
			error: data.error,
			offline: data.offline,
			noRepos: repos !== null && repos.length === 0,
			fetchedAt: pullList?.fetchedAt ?? null,
			refreshing: data.refreshing,
			refresh: list.refresh,
			review,
			starting: data.starting
		}),
		[
			data.phase,
			data.error,
			data.offline,
			data.refreshing,
			data.starting,
			rows,
			counts,
			filter,
			setFilter,
			repoOptions,
			repoId,
			setRepoId,
			query,
			setQuery,
			failures,
			morePages,
			repos,
			pullList,
			list.refresh,
			review
		]
	);
}
