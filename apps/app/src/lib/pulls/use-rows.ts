'use client';

import { useEffect, useMemo } from 'react';
import { useStore } from 'zustand';

import { useApi, useListStore } from '../api/client';
import type { ListData } from './list-store';
import { byActivity, pullKey, pullRow, type ListedPull } from './pull-rows';
import type { PullRow } from './types';

/** A listed pull request with its row. */
export interface RowEntry {
	listed: ListedPull;
	row: PullRow;
}

/** Each pull request with the review its row shows: one started here until the list catches up, else the server's. */
function listedPulls(data: Pick<ListData, 'list' | 'started'>): ListedPull[] {
	return (data.list?.items ?? []).map((item) => ({
		item,
		review: data.started[pullKey(item.repoId, item.pull.number)] ?? item.review
	}));
}

/** Keeps the shared list fresh while the calling screen shows. */
export function useWatchList(): void {
	const list = useListStore();

	useEffect(() => list.watch(), [list]);
}

/** Every open pull request as a row, newest activity first; rebuilt only when the list, the repositories or a start changes. */
export function useRowEntries(): RowEntry[] {
	const { base } = useApi();
	const { state } = useListStore();
	const list = useStore(state, (data) => data.list);
	const started = useStore(state, (data) => data.started);
	const repos = useStore(state, (data) => data.repos);

	return useMemo(
		() =>
			listedPulls({ list, started })
				.map((listed) => ({ listed, row: pullRow(listed, repos, base) }))
				.sort((a, b) => byActivity(a.row, b.row)),
		[list, started, repos, base]
	);
}
