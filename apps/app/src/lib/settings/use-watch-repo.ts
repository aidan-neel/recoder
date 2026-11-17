'use client';

import type { Repo } from '@recoder/shared';

import { AUTO_REVIEW_FAILED } from './auto-review-failed';
import { useAutoReview } from './auto-review-store';
import { useInstantChange, type SaveState } from './use-save-state';

/**
 * Why a repository's switch is held off: a local clone has no comments or pull requests to watch, and while only
 * your own repositories are watched, one the connected account does not own is left alone.
 */
type WatchHold = 'local' | 'notOwned';

/** Everything one repository's watch switch shows and does. */
export interface WatchRepoView {
	/** The switch's position: off while it is held. */
	on: boolean;
	/** Why the switch is held off, or null when it is free to move. */
	hold: WatchHold | null;
	disabled: boolean;
	state: SaveState;
	/** Saves the new watched state the moment the switch moves. */
	change: (on: boolean) => void;
}

/** Automations → Repositories: whether the watcher checks this repository, and why it can't when it is held off. */
export function useWatchRepo(repo: Repo): WatchRepoView {
	const watched = useAutoReview((state) => !state.payload?.settings.excludedRepoIds.includes(repo.id));

	const notOwned = useAutoReview(
		(state) => !!state.payload?.settings.ownReposOnly && !state.payload.status.ownRepoIds.includes(repo.id)
	);

	const hold = watchHold(repo, notOwned);

	const toggle = useInstantChange((on: boolean) => useAutoReview.getState().watchRepo(repo.id, on), AUTO_REVIEW_FAILED);

	return {
		on: hold === null && (toggle.draft ? toggle.draft.value : watched),
		hold,
		disabled: hold !== null,
		state: toggle.state,
		change: toggle.change
	};
}

function watchHold(repo: Repo, notOwned: boolean): WatchHold | null {
	if (repo.provider === 'local') return 'local';
	if (notOwned) return 'notOwned';

	return null;
}
