import type { DispatchLevel } from '@recoder/shared';
import type { ReviewRole } from './roles.js';
import { effectiveDispatchLevel } from './review-settings.js';

/**
 * How many specialists one review may dispatch, chosen in Settings → Review
 * harness. These are ceilings on the first pass (planned assignments,
 * mandatory roles and coverage sweeps together), on follow-ups and retries,
 * and on how long each specialist may dig. Changes a lower level leaves
 * unassigned are reported as coverage gaps, never silently skipped.
 */
export interface DispatchPolicy {
	level: DispatchLevel;
	/** Assignments the planner may write itself. */
	maxInitialAssignments: number;
	/** The whole first pass: planned, mandatory and sweep assignments together. */
	maxSpecialists: number;
	/** Extra correctness assignments over code hunks the plan left out. */
	maxSweepAssignments: number;
	maxFollowUpAssignments: number;
	/** Failed specialists re-dispatched after the first pass. */
	maxRetryAssignments: number;
	/** Model turns (evidence rounds plus the answer) one specialist gets. */
	maxSpecialistTurns: number;
	/** Roles that always run on executable code, unless the developer's instructions exclude them. */
	mandatoryRoles: readonly ReviewRole[];
	/** Plans with more specialists than this wait for the developer's go-ahead. */
	approvalThreshold: number;
}

const POLICIES: Record<DispatchLevel, DispatchPolicy> = {
	low: {
		level: 'low',
		maxInitialAssignments: 2,
		maxSpecialists: 3,
		maxSweepAssignments: 1,
		maxFollowUpAssignments: 0,
		maxRetryAssignments: 2,
		maxSpecialistTurns: 6,
		mandatoryRoles: ['correctness'],
		approvalThreshold: 3
	},
	medium: {
		level: 'medium',
		maxInitialAssignments: 5,
		maxSpecialists: 8,
		maxSweepAssignments: 3,
		maxFollowUpAssignments: 1,
		maxRetryAssignments: 4,
		maxSpecialistTurns: 9,
		mandatoryRoles: ['correctness', 'patterns'],
		approvalThreshold: 5
	},
	high: {
		level: 'high',
		maxInitialAssignments: 12,
		maxSpecialists: 16,
		maxSweepAssignments: 6,
		maxFollowUpAssignments: 2,
		maxRetryAssignments: 8,
		maxSpecialistTurns: 12,
		mandatoryRoles: ['correctness', 'patterns'],
		approvalThreshold: 8
	}
};

export function dispatchPolicy(level: DispatchLevel): DispatchPolicy {
	return POLICIES[level];
}

/** The policy for the level saved in settings (medium when unset). */
export function currentDispatch(): DispatchPolicy {
	return POLICIES[effectiveDispatchLevel()];
}

/** The level used when a caller doesn't say: the saved setting, like a review would. */
export const DEFAULT_DISPATCH: DispatchPolicy = POLICIES.medium;
