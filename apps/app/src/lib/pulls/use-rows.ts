'use client';

import { useEffect, useMemo } from 'react';
import { useStore } from 'zustand';

import type { PullListItem } from '@recoder/shared';

import { useApi, useListStore } from '../api/client';
import type { ListData } from './list-store';
import { byActivity, pullKey, pullRow, type ListedPull } from './pull-rows';
import type { PullRow } from './types';

/** A listed pull request with its row. */
export interface RowEntry {
	listed: ListedPull;
	row: PullRow;
}

/** Each pull request as a row entry, newest activity first, with the review its row shows: one started here until the list catches up, else the server's. */
function rowEntries(
	items: PullListItem[],
	started: ListData['started'],
	repos: ListData['repos'],
	base: string
): RowEntry[] {
	return items
		.map((item) => {
			const listed: ListedPull = { item, review: started[pullKey(item.repoId, item.pull.number)] ?? item.review };

			return { listed, row: pullRow(listed, repos, base) };
		})
		.sort((a, b) => byActivity(a.row, b.row));
}

/** Keeps the shared list fresh while the calling screen shows. */
export function useWatchList(): void {
	const list = useListStore();

	useEffect(() => list.watch(), [list]);
}

/**
 * Every open pull request as a row: the first pages newest activity first, then each page read since in the order it
 * arrived, so rows already shown never move. Rebuilt only when the list, the repositories or a start changes.
 */
export function useRowEntries(): RowEntry[] {
	const { base } = useApi();
	const { state } = useListStore();
	const list = useStore(state, (data) => data.list);
	const more = useStore(state, (data) => data.more.items);
	const started = useStore(state, (data) => data.started);
	const repos = useStore(state, (data) => data.repos);

	return useMemo(() => {
		const first = list?.items ?? [];
		const shown = new Set(first.map((item) => pullKey(item.repoId, item.pull.number)));
		const later = more.filter((item) => !shown.has(pullKey(item.repoId, item.pull.number)));

		return [...rowEntries(first, started, repos, base), ...rowEntries(later, started, repos, base)];
	}, [list, more, started, repos, base]);
}
