/**
 * Balanced default ceilings for one adaptive review.
 * These are limits, not targets: a small PR should normally need only the
 * two baseline specialists (correctness + repository consistency).
 */
export const REVIEW_POLICY = {
	maxInitialAssignments: 6,
	maxFollowUpAssignments: 2,
	maxConcurrentAssignments: 2,
	maxSpecialistTurns: 12,
	maxPlannerTurns: 5,
	maxFollowUpPasses: 1,
	maxConsolidationCalls: 1,
	maxModelCalls: 200,
	analysisDeadlineMs: 30 * 60 * 1000,
	perCallDeadlineMs: 90_000,
	maxRetrievalsPerTurn: 4,
	maxReadLines: 200,
	maxSearchMatches: 50,
	maxToolRoundChars: 24_000,
	schemaRepairAttempts: 4,
	/** Reasoning longer than this (or looping) is cut off and the model is told to answer. */
	maxReasoningChars: 32_000,
	reserveCallsForConsolidation: 1,
	reserveMsForConsolidation: 90_000,
	maxListPage: 200,

	// Code execution in the review sandbox.
	/** Dependency install before any check or repro runs (network on, scripts off). */
	setupTimeoutMs: 10 * 60 * 1000,
	/** Commands the planner picks to run on the PR head before specialists start. */
	maxBaselineChecks: 4,
	maxRunsPerTurn: 2,
	defaultRunTimeoutMs: 120_000,
	maxRunTimeoutMs: 300_000,
	/** Head and tail of a command's combined output kept as evidence. */
	maxRunOutputChars: 20_000,
	maxWriteFileChars: 64_000,

	// Verification: every candidate finding is re-proven by running code.
	maxVerifications: 16,
	maxConcurrentVerifications: 2,
	maxVerifierTurns: 6,
	/** Held back from planning and specialists so verification always gets to run. */
	reserveMsForVerification: 8 * 60 * 1000,
	reserveCallsForVerification: 50
} as const;

export type ReviewPolicy = typeof REVIEW_POLICY;
