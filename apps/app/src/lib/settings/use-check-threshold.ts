'use client';

import { DEFAULT_AUTO_REVIEW_SETTINGS, FINDING_SEVERITIES, type CheckThreshold } from '@recoder/shared';

import { useAutoReview } from './auto-review-store';
import { useCheckThresholdStore } from './check-threshold-store';
import type { SaveState } from './use-save-state';

/** Everything the check-threshold control shows and does. */
export interface CheckThresholdView {
	value: CheckThreshold;
	/** The choices, strictest first, then `off`. */
	options: { value: CheckThreshold; label: string }[];
	state: SaveState;
	/** Why the last save was refused, or null. */
	error: string | null;
	choose: (value: CheckThreshold) => void;
}

const LABELS: Record<CheckThreshold, string> = {
	error: 'High severity',
	warning: 'Medium and above',
	info: 'Any finding',
	off: 'No check'
};

/** The choices the select offers: every severity strictest first, then `off`. */
const OPTIONS: CheckThresholdView['options'] = [
	...[...FINDING_SEVERITIES].reverse().map((severity) => ({ value: severity, label: LABELS[severity] })),
	{ value: 'off', label: LABELS.off }
];

/**
 * The lowest finding severity that fails the commit check Recoder sets on the
 * pull request's head, or none. The picked value shows at once; when the save
 * is refused it goes back to the saved one and says why.
 */
export function useCheckThreshold(): CheckThresholdView {
	const saved = useAutoReview(
		(state) => state.payload?.settings.checkThreshold ?? DEFAULT_AUTO_REVIEW_SETTINGS.checkThreshold
	);

	const draft = useCheckThresholdStore((state) => state.draft);
	const face = useCheckThresholdStore((state) => state.state);
	const error = useCheckThresholdStore((state) => state.error);
	const choose = useCheckThresholdStore((state) => state.choose);

	return { value: draft ?? saved, options: OPTIONS, state: face, error, choose };
}
