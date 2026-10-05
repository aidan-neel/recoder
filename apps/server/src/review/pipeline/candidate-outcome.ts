import type { DropStage } from '@recoder/shared';
import { isHeldBack, type CandidateFinding } from './consolidate.js';
import type { PublishedBy } from './published-by.js';

/** Where a candidate stopped: a drop stage, or `unproven` when no verifier settled it. */
export type StopStage = DropStage | 'unproven';

/** How far a candidate got, for an eval that reads a review's candidates. */
export interface CandidateOutcome {
	/** The stage that stopped it; null when it reached consolidation. */
	stage: StopStage | null;
	reason: string | null;
	/** Whether a verifier proved it, whether or not it was then held back. */
	verified: boolean;
	/** For a candidate below the reporting bar that is published anyway, why; absent otherwise. */
	publishedBy?: PublishedBy;
}

const HELD_REASON = 'low severity is below the reporting bar';

/** Why a candidate below the reporting bar is published anyway; nothing for one that never was below it. */
function publishedBy(candidate: CandidateFinding): Pick<CandidateOutcome, 'publishedBy'> {
	return candidate.belowBar && candidate.publishedBy ? { publishedBy: candidate.publishedBy } : {};
}

/** The stage that stopped a candidate and why, from the state the pipeline left it in. */
export function candidateOutcome(candidate: CandidateFinding): CandidateOutcome {
	const verified = candidate.valid && candidate.verification?.status === 'verified';

	if (!candidate.valid) {
		return {
			stage: candidate.dropStage ?? (candidate.refuted ? 'refuted' : null),
			reason: candidate.dropReason ?? null,
			verified
		};
	}

	if (isHeldBack(candidate)) return { stage: 'severity', reason: HELD_REASON, verified };
	if (verified) return { stage: null, reason: null, verified, ...publishedBy(candidate) };

	return { stage: 'unproven', reason: candidate.verification?.reason ?? 'no verifier settled it', verified };
}
