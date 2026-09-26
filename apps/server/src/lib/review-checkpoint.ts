import type { ReviewAssignment } from '@recoder/shared';
import type { CandidateFinding } from './consolidate.js';
import type { CoverageEntry } from './coverage.js';
import type { EvidenceSnapshot } from './evidence.js';
import type { PlannerAssignment, PlannerOutput } from './planner.js';

/**
 * Where an unfinished review stopped. Saved after planning and after each
 * specialist, so "Continue review" reruns only what didn't finish: planning
 * is skipped, finished specialists keep their candidates, and verification
 * and consolidation run on the combined set.
 */
export interface ReviewCheckpoint {
	/** The review id. */
	id: string;
	/** The PR head and merge base the saved work was done on; a different diff starts over. */
	headSha: string;
	mergeBaseSha: string;
	plan: PlannerOutput;
	planningDegraded: boolean;
	/** Every assignment the review launched, the planner's and follow-ups. */
	items: PlannerAssignment[];
	assignments: ReviewAssignment[];
	/** Candidates from finished assignments only. */
	candidates: CandidateFinding[];
	coverage: CoverageEntry[];
	evidence: EvidenceSnapshot;
	recommended: string[];
	/** Follow-ups finished specialists asked for, not yet chosen from. */
	followUps: PlannerAssignment[];
	/** Follow-up selection already ran, so a resume doesn't ask for more. */
	followUpsDone: boolean;
}
