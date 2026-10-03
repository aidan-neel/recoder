import type { ReviewAssignment } from '@recoder/shared';
import type { CandidateFinding } from '../pipeline/consolidate.js';
import type { CoverageEntry } from '../pipeline/coverage.js';
import type { EvidenceSnapshot } from '../../evidence/evidence.js';
import type { ReviewUnit } from '../pipeline/units.js';
import type { ReviewDirective } from '../chat/directive.js';

/**
 * Where an unfinished review stopped. Saved once the units are cut and after
 * each reviewer, so "Continue review" reruns only what didn't finish: finished
 * units keep their candidates, and verification and consolidation run on the
 * combined set.
 */
export interface ReviewCheckpoint {
	/** The review id. */
	id: string;
	/** The PR head and merge base the saved work was done on; a different diff starts over. */
	headSha: string;
	mergeBaseSha: string;
	/** The developer's instructions as read at the start; reapplied on resume. */
	directive: ReviewDirective | null;
	planningDegraded: boolean;
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
}
