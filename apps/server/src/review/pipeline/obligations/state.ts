import type { Obligation, ObligationAnswer } from '@recoder/shared';
import type { ReviewUnit } from '../units.js';
import { obligationCap, obligationTimeBoxMs } from './config.js';

/** A review's obligations as they stand; saved in its checkpoint so a resume reruns only unanswered ones. */
export interface ObligationState {
	/** Every obligation the change set off; null until derivation finished. */
	derived: Obligation[] | null;
	/** Why nothing was derived, when derivation could not run. */
	skipped: string | null;
	/** One investigation unit per obligation the cap let through. */
	units: ReviewUnit[];
	answers: ObligationAnswer[];
	cap: number;
	timeBoxMs: number;
}

/** A copy of a saved state, or a fresh one under the current cap and time box. */
export function restoreObligationState(saved: ObligationState | undefined): ObligationState {
	return saved
		? structuredClone(saved)
		: { derived: null, skipped: null, units: [], answers: [], cap: obligationCap(), timeBoxMs: obligationTimeBoxMs() };
}
