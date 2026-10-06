import type { ReviewAssignment } from '@recoder/shared';
import type { CandidateFinding } from '../pipeline/consolidate.js';
import type { CoverageEntry } from '../pipeline/coverage.js';
import type { EvidenceSnapshot } from '../../evidence/evidence.js';
import type { ObligationState } from '../pipeline/obligations/state.js';
import type { SubagentState } from '../pipeline/subagents.js';
import type { Received } from '../pipeline/harness/received.js';
import type { ReviewUnit } from '../pipeline/units.js';
import type { ReviewDirective } from '../chat/directive.js';

/**
 * Bumped whenever the checkpoint's shape changes. Version 1 is the first with
 * review units; version 2 saves one assignment per unit and lens, with
 * claim-bearing candidates.
 */
export const CHECKPOINT_VERSION = 2;

/**
 * Where an unfinished review stopped. Saved once the units are cut and after
 * each reviewer, so "Continue review" reruns only what didn't finish: finished
 * units keep their candidates, and verification and consolidation run on the
 * combined set.
 */
export interface ReviewCheckpoint {
	/** The checkpoint format; a checkpoint saved in another format is discarded, not resumed. */
	version: typeof CHECKPOINT_VERSION;
	/** The review id. */
	id: string;
	/** The PR head and merge base the saved work was done on; a different diff starts over. */
	headSha: string;
	mergeBaseSha: string;
	/** The developer's instructions as read at the start; reapplied on resume. */
	directive: ReviewDirective | null;
	/** Every unit the review launched, retries included. */
	units: ReviewUnit[];
	assignments: ReviewAssignment[];
	/** Candidates from finished assignments only. */
	candidates: CandidateFinding[];
	coverage: CoverageEntry[];
	evidence: EvidenceSnapshot;
	recommended: string[];
	/** Failed units were already retried, so a resume doesn't retry them again. */
	retriesDone: boolean;
	/** Subagent requests, and the subagents picked from them once planned. */
	subagents: SubagentState;
	/** Finished reviewers' prompts as built and their retrievals, so a replay records them without rebuilding; absent from older checkpoints. */
	received?: Received;
	/** Candidate repairs the review already attempted, counted against its cap; absent when none were. */
	repairs?: number;
	/** Derived obligations and the answers so far; absent unless `RECODER_OBLIGATIONS=1`. */
	obligations?: ObligationState;
}

/** A saved checkpoint this run can resume from, or why the review starts over instead. */
export function resumableCheckpoint(
	saved: ReviewCheckpoint | null | undefined,
	revision: { headSha: string; mergeBaseSha: string }
): { checkpoint: ReviewCheckpoint | null; discarded: string | null } {
	if (!saved) return { checkpoint: null, discarded: null };

	if (saved.version !== CHECKPOINT_VERSION) {
		return { checkpoint: null, discarded: 'This review was saved by an older Recoder, so it starts over.' };
	}

	if (saved.headSha !== revision.headSha || saved.mergeBaseSha !== revision.mergeBaseSha) {
		return { checkpoint: null, discarded: 'The pull request changed since the last run, so the review starts over.' };
	}

	return { checkpoint: saved, discarded: null };
}
