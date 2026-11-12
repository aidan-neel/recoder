import { DEFAULT_AUTO_REVIEW_SETTINGS, type CheckThreshold } from '@recoder/shared';
import { create } from 'zustand';

import { useAutoReview } from './auto-review-store';
import { createSaveTracker, type SaveState } from './use-save-state';

/** What the check-threshold control keeps between renders. */
interface CheckThresholdStore {
	/** The picked value while its save runs, else null: the saved one shows. */
	draft: CheckThreshold | null;
	/** Why the last save was refused, or null. */
	error: string | null;
	/** The save's face: pending while it runs, then success or error. */
	state: SaveState;
	/**
	 * Picks a threshold; it shows at once and goes back when the save fails.
	 * A pick equal to the shown value does nothing.
	 */
	choose: (value: CheckThreshold) => Promise<void>;
}

/** The commit-check threshold control's state, kept outside React so it can be tested. */
export const useCheckThresholdStore = create<CheckThresholdStore>((set, get) => {
	const saves = createSaveTracker();

	saves.subscribe((next) => set({ state: next.state }));

	function saved(): CheckThreshold {
		return useAutoReview.getState().payload?.settings.checkThreshold ?? DEFAULT_AUTO_REVIEW_SETTINGS.checkThreshold;
	}

	async function choose(value: CheckThreshold): Promise<void> {
		if (value === (get().draft ?? saved())) return;

		set({ draft: value, error: null });

		const failure = await saves.track(useAutoReview.getState().save({ checkThreshold: value }));

		if (get().draft !== value) return;

		set({ draft: null, error: failure });
	}

	return { draft: null, error: null, state: 'idle', choose };
});
