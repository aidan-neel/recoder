'use client';

import type { RemoteRepo } from '@recoder/shared';
import type { ButtonStatus } from '@recoder/ui';
import { useEffect } from 'react';

import type { Forge } from '../api/connections';
import { errorToast } from '../shell/notify';
import { useAction } from '../shell/use-action';
import { trackedKeys, useConnections, type RemoteList as Remote } from './connections-store';
import { signedInForges } from './forges';
import { repoKey } from './repo-input';
import { queryTerms } from '../settings/model-options';
import { useAddRepo } from './use-add-repo';

/** A pending/success/failure face a hook exposes for one async action. */
export interface ActionFace {
	status: ButtonStatus;
	/** Runs the action; `status` walks idle → pending → success or error. */
	run: () => void;
}

/** One repository row in the remote list: the repo, and whether it is already tracked. */
export interface RemoteRowView {
	repo: RemoteRepo;
	tracked: boolean;
}

/** A forge whose repository list failed, above the rows that did load. */
export interface RemoteNoteView {
	forge: Forge;
	/** The list's reason, or null while a retry runs. */
	error: string | null;
	retrying: boolean;
	retry: () => void;
}

/** What the remote list shows, one kind per state the markup used to pick between. */
export type RemoteListView =
	| {
			kind: 'auth-error';
			/** The forge check's reason; null when the server never answered (show OFFLINE_TEXT as the lead). */
			error: string | null;
			retry: ActionFace;
	  }
	| { kind: 'checking' }
	| { kind: 'no-forge' }
	| { kind: 'loading' }
	| {
			kind: 'failed';
			/** The first failed list's reason. */
			error: string | null;
			retrying: boolean;
			retry: () => void;
	  }
	| { kind: 'empty'; query: string }
	| { kind: 'ready'; rows: RemoteRowView[]; notes: RemoteNoteView[] };

/** Keeps the rows whose name holds every word of the query. */
function matching(repos: RemoteRepo[], query: string): RemoteRepo[] {
	const terms = queryTerms(query);

	return repos.filter((repo) => terms.every((term) => repo.name.toLowerCase().includes(term)));
}

/** True when a forge's list failed, including while a retry of it runs. */
function failedList(list: Remote | undefined): boolean {
	return list?.status === 'error' || list?.status === 'retrying';
}

/**
 * Tracks a remote repository from its row's Add button. A refusal raises an
 * error toast; the row's own status walks pending → success or error.
 */
export function useTrackRepo(): { status: ButtonStatus; track: (repo: RemoteRepo) => Promise<void> } {
	const [status, add] = useAddRepo();

	async function track(repo: RemoteRepo): Promise<void> {
		const result = await add({ name: repo.name, url: repo.url, provider: repo.provider });

		if ('error' in result) errorToast(`Couldn’t add ${repo.name}`, result.error);
	}

	return { status, track };
}

/**
 * What the repository browser lists: the repositories the signed-in forges
 * can see, filtered by `query`, tracked ones marked. Call it once inside the
 * dialog's body so each opening loads the forges' lists afresh.
 */
export function useRemoteList(query: string): RemoteListView {
	const auth = useConnections((state) => state.auth);
	const authStatus = useConnections((state) => state.authStatus);
	const authError = useConnections((state) => state.authError);
	const remote = useConnections((state) => state.remote);
	const repos = useConnections((state) => state.repos);
	const recheck = useAction();

	const forges = signedInForges(auth);
	const forgesKey = forges.join(' ');

	useEffect(() => {
		for (const forge of signedInForges(useConnections.getState().auth)) {
			void useConnections.getState().loadRemote(forge);
		}
	}, [forgesKey]);

	if (!auth && (authStatus === 'error' || authStatus === 'offline')) {
		return {
			kind: 'auth-error',
			error: authError,
			retry: {
				status: recheck.status,
				run: () => recheck.run(() => useConnections.getState().loadAuth())
			}
		};
	}

	if (!auth) return { kind: 'checking' };

	if (forges.length === 0) return { kind: 'no-forge' };

	const lists = forges.map((forge) => remote[forge]);
	const failed = forges.filter((forge) => failedList(remote[forge]));
	const tracked = trackedKeys(repos);

	if (lists.some((list) => !list || list.status === 'loading')) return { kind: 'loading' };

	if (failed.length === forges.length) {
		return {
			kind: 'failed',
			error: remote[failed[0]]?.error ?? null,
			retrying: failed.some((forge) => remote[forge]?.status === 'retrying'),
			retry: () => failed.forEach((forge) => void useConnections.getState().loadRemote(forge))
		};
	}

	const rows = matching(
		lists.flatMap((list) => (list?.status === 'ready' ? list.repos : [])),
		query
	).map((repo) => ({ repo, tracked: tracked.has(repoKey(repo.url)) }));

	if (rows.length === 0) return { kind: 'empty', query: query.trim() };

	return {
		kind: 'ready',
		rows,
		notes: failed.map((forge) => ({
			forge,
			error: remote[forge]?.error ?? null,
			retrying: remote[forge]?.status === 'retrying',
			retry: () => void useConnections.getState().loadRemote(forge)
		}))
	};
}
