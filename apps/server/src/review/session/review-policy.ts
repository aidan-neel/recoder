/**
 * Balanced default ceilings for one adaptive review.
 * These are limits, not targets: a small PR is normally one review unit.
 */
export const REVIEW_POLICY = {
	/** Each lens assignment adds this many model calls to the base `maxModelCalls`… */
	callsPerAssignment: 8,
	/** …up to this many in all. */
	maxScaledModelCalls: 2000,
	/** Each lens assignment adds this much time to the base `analysisDeadlineMs`… */
	msPerAssignment: 30_000,
	/** …up to this long in all. */
	maxScaledDeadlineMs: 2 * 60 * 60 * 1000,
	/** Failed assignments rerun after the first pass; each is retried once, split in two when it was too big. */
	maxRetryUnits: 24,
	/** Reviewers running at once in one review; the model limiter (`RECODER_LLM_CONCURRENCY`) throttles across reviews. */
	maxConcurrentAssignments: 12,
	/**
	 * Patch characters one review unit holds. Matches `maxToolRoundChars`, so a
	 * reviewer starts with its whole patch in one evidence round.
	 */
	unitBudgetChars: 24_000,
	/** A lens starts with its unit's patch and change-model context, so it needs few turns of its own. */
	maxLensTurns: 8,
	/** A subagent follows one question across the repo from scratch. */
	maxSubagentTurns: 12,
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
	/** Checks run on the PR head, at once and alongside the reviewers. */
	maxBaselineChecks: 4,
	/** Each baseline check is cut short here. */
	baselineCheckTimeoutMs: 180_000,
	/**
	 * Once the reviewers and verifiers are done, the review waits this long for
	 * baseline checks still queued behind other reviews, then finishes without
	 * their diagnostics.
	 */
	baselineGraceMs: 20_000,
	/**
	 * The install prepares the environment; it is not analysis. The time it
	 * takes is added back to the review's deadlines, up to this much.
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
	/** Verifiers running at once, alongside the reviewers still working. */
	maxConcurrentVerifications: 6,
	maxVerifierTurns: 10,
	/**
	 * A mutation verifier reads the test, reads the code under test, plants the
	 * bug and runs the test in one command, then answers, so 10 turns ran out
	 * before the run.
	 */
	maxMutationVerifierTurns: 14,
	/** The proving command, run again on the merge-base tree by the harness; cut short here. */
	baseRunTimeoutMs: 60_000,
	/** One verifier's own clock: told to answer after the first, stopped at the second. */
	verifierFinalTurnAfterMs: 5 * 60 * 1000,
	verifierMaxMs: 7 * 60 * 1000,
	/** The same for one reviewer or subagent. */
	reviewerFinalTurnAfterMs: 12 * 60 * 1000,
	reviewerMaxMs: 15 * 60 * 1000,
	/** Each wave of `maxConcurrentVerifications` verifiers adds this much time. */
	msPerVerificationWave: 5 * 60 * 1000,
	/** Held back from reviewers and subagents so the last verifiers always get to run. */
	reserveMsForVerification: 8 * 60 * 1000
} as const;

/**
 * The model-call budget and analysis deadline for a review of `assignments`
 * lens assignments: the base, plus a share per assignment, capped.
 */
export function scaledReviewLimits(assignments: number): { modelCalls: number; deadlineMs: number } {
	const policy = REVIEW_POLICY;

	return {
		modelCalls: Math.min(policy.maxScaledModelCalls, policy.maxModelCalls + assignments * policy.callsPerAssignment),
		deadlineMs: Math.min(policy.maxScaledDeadlineMs, policy.analysisDeadlineMs + assignments * policy.msPerAssignment)
	};
}

/** The turn limit of one verifier; a mutation verifier has more because it works in more steps. */
export function verifierTurns(mutation: boolean): number {
	return mutation ? REVIEW_POLICY.maxMutationVerifierTurns : REVIEW_POLICY.maxVerifierTurns;
}
