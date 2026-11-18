'use client';

import { useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { useStore } from 'zustand';
import { useShallow } from 'zustand/react/shallow';

import { useApi, useListStore, useOverviewCache } from '../api/client';
import { useRowEntries, useWatchList } from '../pulls/use-rows';
import { reposHref } from '../shell/routes';
import {
	FLEET_SCOPES,
	fleetScopeOf,
	fleetTiles,
	inScope,
	matchesFilter,
	scopeCounts,
	type FleetScope,
	type FleetTile,
	type OverviewRead
} from './fleet';
import { stopTracking } from './stop-tracking';

/** One scope of the page as a tab: its name, its address and the repositories under it. */
interface FleetScopeTab {
	id: FleetScope;
	label: string;
	href: string;
	count: number;
}

/** What the Repositories page shows and does. */
export interface ReposPageView {
	/** `loading` until the tracked repositories first answer; `failed` when the first read failed. */
	phase: 'loading' | 'ready' | 'failed';
	error: string | null;
	retry: () => void;
	/** The repositories under the scope and the filter text, those with something to do first. */
	tiles: FleetTile[];
	/** How many repositories are tracked, whatever the scope and the filter. */
	tracked: number;
	scope: FleetScope;
	scopes: FleetScopeTab[];
	query: string;
	setQuery: (query: string) => void;
	/** How many days the tiles' charts and merge counts cover; null until an overview answers. */
	days: number | null;
	/** Reads again the overviews that did not load. */
	retryOverviews: () => void;
	/** Whether the Add repository dialog is open. */
	adding: boolean;
	/** Opens or closes the dialog; closing it reads the list again, so a repository just added shows. */
	setAdding: (open: boolean) => void;
	/** Stops tracking a repository, with Undo in its toast. */
	stop: (tile: FleetTile) => void;
}

/**
 * Every tracked repository's overview. The copies read before paint at once, and each is read again once per visit.
 * A read that fails keeps a copy already on screen, and with none reads as failed until `retry`.
 */
function useOverviews(repoIds: readonly string[]): { of: (repoId: string) => OverviewRead; retry: () => void } {
	const overviews = useOverviewCache();
	const [failed, setFailed] = useState<ReadonlySet<string>>(new Set());
	const [, setAnswers] = useState(0);
	const [attempt, setAttempt] = useState(0);
	const wanted = repoIds.join('\n');

	const retry = useCallback(() => {
		setFailed(new Set());
		setAttempt((count) => count + 1);
	}, []);

	useEffect(() => {
		let current = true;

		for (const repoId of wanted ? wanted.split('\n') : []) {
			overviews.read(repoId).then(
				() => current && setAnswers((count) => count + 1),
				() => current && setFailed((before) => new Set(before).add(repoId))
			);
		}

		return () => {
			current = false;
		};
	}, [overviews, wanted, attempt]);

	return { of: (repoId) => overviews.peek(repoId) ?? (failed.has(repoId) ? 'failed' : 'loading'), retry };
}

/** The scope's address: the page itself for every repository, else the page with the scope named. */
function scopeHref(base: string, scope: FleetScope): string {
	return scope === 'all' ? reposHref(base) : `${reposHref(base)}?scope=${scope}`;
}

/**
 * The Repositories page: every tracked repository as a tile, from the list the sidebar reads, so a repository added
 * or stopped here changes there at once. The address names the scope; the filter text narrows by name.
 */
export function useReposPage(): ReposPageView {
	useWatchList();

	const { base } = useApi();
	const store = useListStore();
	const entries = useRowEntries();
	const scope = fleetScopeOf(useSearchParams().get('scope'));
	const [query, setQuery] = useState('');
	const [adding, setOpen] = useState(false);

	const data = useStore(
		store.state,
		useShallow((current) => ({
			repos: current.repos,
			openCounts: current.list?.openCounts ?? null,
			reviews: current.reviews,
			phase: current.phase,
			error: current.error
		}))
	);

	const overviews = useOverviews((data.repos ?? []).map((repo) => repo.id));

	const all = fleetTiles({
		repos: data.repos ?? [],
		entries,
		openCounts: data.openCounts,
		reviews: data.reviews,
		overviewOf: overviews.of,
		base
	});

	const named = all.filter((tile) => matchesFilter(tile, query));
	const counts = scopeCounts(named);
	const [answered] = all.flatMap((tile) => (tile.overview.phase === 'ready' ? [tile.overview.days] : []));

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
		tiles: named.filter((tile) => inScope(tile, scope)),
		tracked: all.length,
		scope,
		scopes: FLEET_SCOPES.map(({ id, label }) => ({ id, label, href: scopeHref(base, id), count: counts[id] })),
		query,
		setQuery,
		days: answered ?? null,
		retryOverviews: overviews.retry,
		adding,
		setAdding,
		stop: (tile) => stopTracking(store, { id: tile.id, name: tile.owner ? `${tile.owner}/${tile.name}` : tile.name })
	};
}
