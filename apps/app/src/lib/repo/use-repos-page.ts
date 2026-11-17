'use client';

import type { Provider, Repo } from '@recoder/shared';
import { useMemo, useState } from 'react';
import { useStore } from 'zustand';
import { useShallow } from 'zustand/react/shallow';

import { useApi, useListStore } from '../api/client';
import { highBugs } from '../pulls/high-bugs';
import { useRowEntries, useWatchList, type RowEntry } from '../pulls/use-rows';
import { repoHref } from '../shell/routes';
import { stopTracking } from './stop-tracking';

/** How a clone on this machine starts its address. */
const LOCAL_PREFIX = 'file://';

/** One tracked repository on the Repositories page. */
export interface RepoListRow {
	id: string;
	/** The owner, shown faint before the name; null for a repository without one. */
	owner: string | null;
	name: string;
	href: string;
	provider: Provider;
	/** Where it lives: the forge's host, or the folder of a clone on this machine. */
	place: string;
	defaultBranch: string;
	/** Its open pull requests, null until the list answers. */
	open: number | null;
	/** One of its open pull requests has an open high-severity bug. */
	alert: boolean;
}

/** What the Repositories page shows and does. */
export interface ReposPageView {
	/** `loading` until the tracked repositories first answer; `failed` when the first read failed. */
	phase: 'loading' | 'ready' | 'failed';
	error: string | null;
	retry: () => void;
	rows: RepoListRow[];
	/** Whether the Add repository dialog is open. */
	adding: boolean;
	/** Opens or closes the dialog; closing it reads the list again, so a repository just added shows. */
	setAdding: (open: boolean) => void;
	/** Stops tracking a repository, with Undo in its toast. */
	stop: (row: RepoListRow) => void;
}

/** Where a repository lives, for the line under its name. An address that does not parse shows as it is. */
function placeOf(url: string): string {
	if (url.startsWith(LOCAL_PREFIX)) return url.slice(LOCAL_PREFIX.length);

	return URL.canParse(url) ? new URL(url).host : url;
}

/** Each repository's open pull requests as the list counts them, and those with a high-severity bug. */
function pullFacts(entries: readonly RowEntry[]): { open: Map<string, number>; alerted: Set<string> } {
	const open = new Map<string, number>();
	const alerted = new Set<string>();

	for (const entry of entries) {
		const { repoId } = entry.listed.item;

		open.set(repoId, (open.get(repoId) ?? 0) + 1);

		if (highBugs(entry) > 0) alerted.add(repoId);
	}

	return { open, alerted };
}

/** One repository as a row: owner and name split, its place and branch, and its open pull requests. */
function rowOf(repo: Repo, base: string, counts: Record<string, number> | null, facts: ReturnType<typeof pullFacts>) {
	const slash = repo.name.lastIndexOf('/');

	return {
		id: repo.id,
		owner: slash > 0 ? repo.name.slice(0, slash) : null,
		name: slash > 0 ? repo.name.slice(slash + 1) : repo.name,
		href: repoHref(base, repo.id),
		provider: repo.provider,
		place: placeOf(repo.url),
		defaultBranch: repo.defaultBranch,
		open: counts ? (counts[repo.id] ?? facts.open.get(repo.id) ?? 0) : null,
		alert: facts.alerted.has(repo.id)
	};
}

/**
 * The Repositories page: every tracked repository by name, from the list the sidebar reads, so a repository added or
 * stopped here changes there at once.
 */
export function useReposPage(): ReposPageView {
	useWatchList();

	const { base } = useApi();
	const store = useListStore();
	const entries = useRowEntries();
	const [adding, setOpen] = useState(false);

	const data = useStore(
		store.state,
		useShallow((current) => ({
			repos: current.repos,
			counts: current.list?.openCounts ?? null,
			phase: current.phase,
			error: current.error
		}))
	);

	const rows = useMemo(() => {
		const facts = pullFacts(entries);

		return (data.repos ?? [])
			.map((repo) => rowOf(repo, base, data.counts, facts))
			.sort(
				(left, right) => left.name.localeCompare(right.name) || (left.owner ?? '').localeCompare(right.owner ?? '')
			);
	}, [data.repos, data.counts, entries, base]);

	function setAdding(open: boolean): void {
		setOpen(open);

		if (!open) store.reload();
	}

	let phase: ReposPageView['phase'] = 'ready';

	if (data.repos === null) phase = data.phase === 'failed' ? 'failed' : 'loading';

	return {
		phase,
		error: data.error,
		retry: store.refresh,
		rows,
		adding,
		setAdding,
		stop: (row) => stopTracking(store, { id: row.id, name: row.owner ? `${row.owner}/${row.name}` : row.name })
	};
}
