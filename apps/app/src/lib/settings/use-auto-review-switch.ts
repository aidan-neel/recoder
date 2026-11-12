'use client';

import type { AutoReviewSettings } from '@recoder/shared';

import { AUTO_REVIEW_FAILED } from './auto-review-failed';
import { useAutoReview } from './auto-review-store';
import { useInstantChange, type SaveState } from './use-save-state';

/** The automation settings that are on or off. */
export type AutoReviewSwitch = {
	[K in keyof AutoReviewSettings]: AutoReviewSettings[K] extends boolean ? K : never;
}[keyof AutoReviewSettings];

/** Everything an on/off automation setting shows and does. */
export interface AutoReviewSwitchView {
	/** The switch's position: the draft while its save runs, else the saved value. */
	on: boolean;
	state: SaveState;
	/** Saves the new value the moment the switch moves. */
	change: (on: boolean) => void;
}

/**
 * One switch, shown at its new value while it saves. `field` names the
 * boolean setting it drives.
 */
export function useAutoReviewSwitch(field: AutoReviewSwitch): AutoReviewSwitchView {
	const saved = useAutoReview((state) => state.payload?.settings[field] ?? false);

	const toggle = useInstantChange(
		(value: boolean) => useAutoReview.getState().save({ [field]: value }),
		AUTO_REVIEW_FAILED
	);

	return { on: toggle.draft ? toggle.draft.value : saved, state: toggle.state, change: toggle.change };
}
