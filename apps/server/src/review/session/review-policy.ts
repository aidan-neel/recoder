/**
 * Balanced default ceilings for one adaptive review.
 * These are limits, not targets: a small PR is normally one review unit.
 */
export const REVIEW_POLICY = {
	/** Each unit past `baseUnits` adds this many model calls to the budget… */
	callsPerExtraUnit: 10,
	/** …and each wave of `maxConcurrentAssignments` past the first adds this much time. */
	msPerExtraWave: 8 * 60 * 1000,
	/** Failed units rerun after the first pass; each unit is retried once, split in two when it was too big. */
	maxRetryUnits: 24,
	/** Every reviewer starts at once; the model limiter (`RECODER_LLM_CONCURRENCY`) is the only throttle. */
	maxConcurrentAssignments: 8,
	/**
	 * Patch characters one review unit holds. Matches `maxToolRoundChars`, so a
	 * reviewer starts with its whole patch in one evidence round.
	 */
	unitBudgetChars: 24_000,
	/** Units up to this many fit the base budget and deadline; each one past it adds `callsPerExtraUnit`. */
	baseUnits: 6,
	maxReviewerTurns: 12,
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

	/** Dependency install before any check or repro runs (network on, scripts off). */
	setupTimeoutMs: 8 * 60 * 1000,
	/** Checks run on the PR head before reviewers start. */
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

	/** Every valid candidate is re-proven by running code; budgets grow to fit. This only guards a runaway review. */
	maxVerifications: 120,
	maxConcurrentVerifications: 4,
	maxVerifierTurns: 10,
	/** One verifier's own clock: told to answer after the first, stopped at the second. */
	verifierFinalTurnAfterMs: 5 * 60 * 1000,
	verifierMaxMs: 7 * 60 * 1000,
	/** The same for one reviewer or subagent. */
	reviewerFinalTurnAfterMs: 12 * 60 * 1000,
	reviewerMaxMs: 15 * 60 * 1000,
	/** Each wave of `maxConcurrentVerifications` verifiers adds this much time. */
	msPerVerificationWave: 5 * 60 * 1000,
	/** Held back from reviewers and subagents so verification always gets to run. */
	reserveMsForVerification: 8 * 60 * 1000,
	reserveCallsForVerification: 50
} as const;
