'use client';

import type { AutoReviewPayload, Repo } from '@recoder/shared';
import type { ButtonStatus } from '@recoder/ui';
import { useEffect } from 'react';

import { useConnections } from '../connections/connections-store';
import { whileVisible } from '../review/while-visible';
import { useAction } from '../shell/use-action';
import { useAutoReview } from './auto-review-store';

/** How often the watcher's state is read again while the section is open, for the last check and new reviews. */
const REFRESH_MS = 15_000;

/** What the Auto-review page shows once its loads settle. */
export type AutoReviewView = 'loading' | 'offline' | 'error' | 'ready';

/** Everything the Auto-review page needs. */
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
}

/** Loads the settings and the tracked repositories. */
function load(): Promise<unknown> {
	return Promise.all([useAutoReview.getState().load(), useConnections.getState().loadRepos()]);
}

/**
 * Settings → Auto-review: the watcher that starts reviews on its own when
 * someone mentions Recoder, a pull request opens or new commits land, what
 * it says on the pull request, which repositories it checks, and what it
 * started. Loads on mount and re-reads the watcher's state every 15s while
 * the page is visible.
 */
export function useAutoReviewSection(): AutoReviewSection {
	const status = useAutoReview((state) => state.status);
	const payload = useAutoReview((state) => state.payload);
	const error = useAutoReview((state) => state.error);
	const repos = useConnections((state) => state.repos) ?? [];
	const retry = useAction();

	useEffect(() => {
		void load();

		return whileVisible(REFRESH_MS, () => void useAutoReview.getState().load());
	}, []);

	const view: AutoReviewView =
		status === 'offline' ? 'offline' : status === 'error' ? 'error' : payload ? 'ready' : 'loading';

	return {
		view,
		payload,
		error,
		retry: { status: retry.status, run: () => retry.run(load) },
		repos
	};
}
