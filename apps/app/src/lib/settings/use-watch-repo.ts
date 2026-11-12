'use client';

import type { Repo } from '@recoder/shared';

import { AUTO_REVIEW_FAILED } from './auto-review-failed';
import { useAutoReview } from './auto-review-store';
import { useInstantChange, type SaveState } from './use-save-state';

/** Everything one repository's watch switch shows and does. */
export interface WatchRepoView {
	/** The switch's position: off for a local clone, which has no comments or pull requests to watch. */
	on: boolean;
	/** A local clone's switch is held off. */
	disabled: boolean;
	state: SaveState;
	/** Saves the new watched state the moment the switch moves. */
	change: (on: boolean) => void;
}

/**
 * Settings → Auto-review → Repositories: whether the watcher checks this
 * repository. A local clone has no comments or pull requests to watch, so
 * its switch is held off.
 */
export function useWatchRepo(repo: Repo): WatchRepoView {
	const watched = useAutoReview((state) => !state.payload?.settings.excludedRepoIds.includes(repo.id));
	const local = repo.provider === 'local';

	const toggle = useInstantChange((on: boolean) => useAutoReview.getState().watchRepo(repo.id, on), AUTO_REVIEW_FAILED);

	return {
		on: !local && (toggle.draft ? toggle.draft.value : watched),
		disabled: local,
		state: toggle.state,
		change: toggle.change
	};
}
