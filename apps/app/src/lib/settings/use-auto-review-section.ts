'use client';

import type { AutoReviewPayload, Repo } from '@recoder/shared';
import type { ButtonStatus } from '@recoder/ui';
import { useEffect } from 'react';

import { useConnections, type LoadStatus } from '../connections/connections-store';
import { whileVisible } from '../review/while-visible';
import { useAction } from '../shell/use-action';
import { useAutoReview } from './auto-review-store';

/** How often the watcher's state is read again while the section is open, for the last check and new reviews. */
const REFRESH_MS = 15_000;

/** What the Automations page shows once its loads settle. */
type AutoReviewView = 'loading' | 'offline' | 'error' | 'ready';

/** Where the first load stands; `idle` and `loading` both read as loading. */
type AutoReviewStatus = ReturnType<typeof useAutoReview.getState>['status'];

/** Everything the Automations page needs. */
export interface AutoReviewSection {
	view: AutoReviewView;
	/** The settings and the watcher's state, once loaded; null while loading or after a failure. */
	payload: AutoReviewPayload | null;
	/** The server's reason when the first load failed with an answer. */
	error: string | null;
	/** The notice's retry, for a load that failed. */
	retry: { status: ButtonStatus; run: () => void };
	/** The tracked repositories, which the repository switches and the recent reviews name. */
	repos: Repo[];
	/** Where the tracked repositories' load stands: still loading, failed, or ready. */
	reposState: 'loading' | 'failed' | 'ready';
	/** Why the repository list failed; null while it has not or the server never answered. */
	reposError: string | null;
}

/** Loads the settings and the tracked repositories. */
function load(): Promise<unknown> {
	return Promise.all([useAutoReview.getState().load(), useConnections.getState().loadRepos()]);
}

/** The page's view: a failed first load reads as its status, else whether a payload landed. */
function sectionView(status: AutoReviewStatus, payload: AutoReviewPayload | null): AutoReviewView {
	if (status === 'offline') return 'offline';
	if (status === 'error') return 'error';

	return payload ? 'ready' : 'loading';
}

/**
 * The tracked repositories' load as the section reads it: `idle` and
 * `loading` are still loading, `error` and `offline` failed, `ready` is ready.
 */
export function reposStateOf(status: LoadStatus): 'loading' | 'failed' | 'ready' {
	if (status === 'ready') return 'ready';
	if (status === 'error' || status === 'offline') return 'failed';

	return 'loading';
}

/**
 * Automations: the watcher that starts reviews on its own when someone
 * mentions Recoder, a pull request opens or new commits land, what it says
 * on the pull request, which repositories it checks, and what it started.
 * Loads on mount and re-reads the watcher's state every 15s while the page
 * is visible.
 */
export function useAutoReviewSection(): AutoReviewSection {
	const status = useAutoReview((state) => state.status);
	const payload = useAutoReview((state) => state.payload);
	const error = useAutoReview((state) => state.error);
	const repos = useConnections((state) => state.repos) ?? [];
	const reposStatus = useConnections((state) => state.reposStatus);
	const reposError = useConnections((state) => state.reposError);
	const retry = useAction();

	useEffect(() => {
		void load();

		return whileVisible(REFRESH_MS, () => void useAutoReview.getState().load());
	}, []);

	return {
		view: sectionView(status, payload),
		payload,
		error,
		retry: { status: retry.status, run: () => retry.run(load) },
		repos,
		reposState: reposStateOf(reposStatus),
		reposError
	};
}
