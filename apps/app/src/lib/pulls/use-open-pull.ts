'use client';

import { useCallback, useMemo } from 'react';
import { useStore } from 'zustand';

import { useApi, useListStore } from '../api/client';
import { parseRepoInput } from '../connections/repo-input';
import { pullHref } from '../shell/routes';
import type { ListStore } from './list-store';
import { readTarget } from './pull-target';
import type { PullTarget } from './types';
import { useWatchList } from './use-rows';

/** A pull request in a tracked repository, and its page. */
export interface TrackedPull {
	repoId: string;
	number: number;
	href: string;
}

/**
 * The tracked pull request a target names, tracking its repository first when
 * it is not tracked yet. Rejects with one plain sentence.
 */
export async function trackedPull(target: PullTarget, list: ListStore, base: string): Promise<TrackedPull> {
	if (target.kind === 'empty') throw new Error('Paste a pull request link, or type its number.');
	if (target.kind === 'invalid') throw new Error(target.reason);
	if (target.kind === 'pull') return { repoId: target.repoId, number: target.number, href: target.href };

	const parsed = parseRepoInput(target.repoUrl);

	if (!parsed.ok) throw new Error(parsed.error);

	const repo = await list.track(parsed.repo);

	return { repoId: repo.id, number: target.number, href: pullHref(base, repo.id, target.number) };
}

/** Opens a pull request from pasted text: `resolve` reads it as it is typed, `open` tracks its repository when needed and resolves with its page. */
export function useOpenPull(): { resolve: (text: string) => PullTarget; open: (text: string) => Promise<string> } {
	useWatchList();

	const client = useApi();
	const list = useListStore();
	const repos = useStore(list.state, (data) => data.repos);
	const pulls = useStore(list.state, (data) => data.list);

	const resolve = useCallback(
		(text: string) =>
			readTarget(text, { repos: repos ?? [], pulls: pulls?.items ?? [], base: client.base, repoId: null }).target,
		[repos, pulls, client]
	);

	const open = useCallback(
		async (text: string) => (await trackedPull(resolve(text), list, client.base)).href,
		[resolve, list, client]
	);

	return useMemo(() => ({ resolve, open }), [resolve, open]);
}
