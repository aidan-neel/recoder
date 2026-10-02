/**
 * Balanced default ceilings for one adaptive review.
 * These are limits, not targets: a small PR should normally need only the
 * two baseline specialists (correctness + repository consistency).
 */
export const REVIEW_POLICY = {
	/** Assignments the planner may write itself. */
	maxInitialAssignments: 12,
	/**
	 * Extra correctness assignments over code hunks the plan left out, so every
	 * changed line is read. Each takes a wider scope than a planned one; the cap
	 * is only a guard against a pathological diff (~2.3M patch characters).
	 */
	maxSweepAssignments: 48,
	/** Plans with more specialists than this wait for the developer's go-ahead. */
	approvalThreshold: 5,
	/** Each specialist past the baseline adds this many model calls to the budget… */
	callsPerExtraAssignment: 10,
	/** …and each wave of `maxConcurrentAssignments` past the first adds this much time. */
	msPerExtraWave: 8 * 60 * 1000,
	maxFollowUpAssignments: 2,
	/** Failed specialists the orchestrator may re-dispatch after the first pass. */
	maxRetryAssignments: 24,
	/** Every specialist starts at once; the model limiter (`RECODER_LLM_CONCURRENCY`) is the only throttle. */
	maxConcurrentAssignments: 8,
	maxSpecialistTurns: 12,
	maxPlannerTurns: 5,
	maxFollowUpPasses: 1,
	maxConsolidationCalls: 1,
	maxModelCalls: 320,
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
	setupTimeoutMs: 8 * 60 * 1000,
	/** Commands the planner picks to run on the PR head before specialists start. */
	maxBaselineChecks: 4,
	/** Each baseline check is cut short here, and the whole set at `maxBaselineChecksMs`. */
	baselineCheckTimeoutMs: 180_000,
	maxBaselineChecksMs: 6 * 60 * 1000,
	/**
	 * Setup and baseline checks prepare the environment; they are not analysis.
	 * The time they take is added back to the review's deadlines, up to this much.
	 */
	maxPrepExtensionMs: 14 * 60 * 1000,
	maxRunsPerTurn: 2,
	defaultRunTimeoutMs: 120_000,
	maxRunTimeoutMs: 300_000,
	/** Head and tail of a command's combined output kept as evidence. */
	maxRunOutputChars: 20_000,
	maxWriteFileChars: 64_000,

	// Verification: every candidate finding is re-proven by running code.
	/** Every valid candidate is verified; budgets grow to fit. This only guards a runaway review. */
	maxVerifications: 120,
	maxConcurrentVerifications: 4,
	maxVerifierTurns: 10,
	/** One verifier's own clock: told to answer after the first, stopped at the second. */
	verifierFinalTurnAfterMs: 5 * 60 * 1000,
	verifierMaxMs: 7 * 60 * 1000,
	/** The same for one specialist. */
	specialistFinalTurnAfterMs: 12 * 60 * 1000,
	specialistMaxMs: 15 * 60 * 1000,
	/** Each wave of `maxConcurrentVerifications` verifiers adds this much time. */
	msPerVerificationWave: 5 * 60 * 1000,
	/** Held back from planning and specialists so verification always gets to run. */
	reserveMsForVerification: 8 * 60 * 1000,
	reserveCallsForVerification: 50
} as const;

export type ReviewPolicy = typeof REVIEW_POLICY;
