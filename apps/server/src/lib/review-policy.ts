/**
 * Balanced default ceilings for one adaptive review.
 * These are limits, not targets: a small PR should normally need only the
 * two baseline specialists (correctness + repository consistency).
 */
export const REVIEW_POLICY = {
	maxInitialAssignments: 6,
	maxFollowUpAssignments: 2,
	maxConcurrentAssignments: 2,
	maxSpecialistTurns: 3,
	maxPlannerTurns: 3,
	maxFollowUpPasses: 1,
	maxConsolidationCalls: 1,
	maxModelCalls: 30,
	analysisDeadlineMs: 10 * 60 * 1000,
	perCallDeadlineMs: 90_000,
	maxRetrievalsPerTurn: 4,
	maxReadLines: 200,
	maxSearchMatches: 50,
	maxToolRoundChars: 24_000,
	schemaRepairAttempts: 1,
	reserveCallsForConsolidation: 1,
	reserveMsForConsolidation: 90_000,
	maxListPage: 200
} as const;

export type ReviewPolicy = typeof REVIEW_POLICY;
