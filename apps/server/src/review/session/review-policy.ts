import type { TokenBudget } from '@recoder/shared';

/**
 * Balanced default ceilings for one adaptive review.
 * These are limits, not targets: a small PR is normally one review unit.
 */
export const REVIEW_POLICY = {
	/** Each reviewer and each subagent a review may run adds this much time to the base `analysisDeadlineMs`… */
	msPerAssignment: 60_000,
	/** …up to this long in all. */
	maxScaledDeadlineMs: 2 * 60 * 60 * 1000,
	/** …and the model calls its budget adds are capped at this many, whatever the shape of the review. */
	maxScaledModelCalls: 2000,
	/** Failed assignments rerun after the first pass; each is retried once, split in two when it was too big. */
	maxRetryUnits: 24,
	/** Reviewers running at once in one review; the model limiter (`RECODER_LLM_CONCURRENCY`) throttles across reviews. */
	maxConcurrentAssignments: 12,
	/**
	 * Patch characters one brief unit holds (`partitionUnits`). Matches `maxToolRoundChars`, so a brief
	 * call reads its whole patch at once.
	 */
	unitBudgetChars: 24_000,
	/**
	 * A change whose reviewable patch is longer than this is a larger change, and gets the larger reviewer count
	 * of its token budget. Two brief units' worth: two reviewers still each start with a patch round of their own.
	 */
	largeChangeChars: 48_000,
	maxConsolidationCalls: 1,
	/** The ceiling of a `ModelBudget` made without one; a review's own comes from `scaledReviewLimits`. */
	maxModelCalls: 320,
	analysisDeadlineMs: 30 * 60 * 1000,
	perCallDeadlineMs: 90_000,
	/**
	 * About 60k tokens. Past it, an agent that Recoder runs turn by turn has its
	 * oldest tool output stubbed before the next call. Reviews stay under about
	 * 53k tokens per call today, so this is a safety net; OpenCode compacts its own sessions.
	 */
	maxTranscriptChars: 240_000,
	/**
	 * One second-look call. It rereads a whole unit, and a CLI model that prints
	 * its reply only at the end often needs longer than 90s to answer that; a
	 * timed-out call is sent again in full and times out again.
	 */
	secondLookCallDeadlineMs: 180_000,
	maxRetrievalsPerTurn: 4,
	maxReadLines: 200,
	maxSearchMatches: 30,
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
	/**
	 * A second look's own clock. Each of its calls may take `secondLookCallDeadlineMs`,
	 * so its final turn starts early enough for a call still in flight and the
	 * final call itself to finish before it is stopped.
	 */
	secondLookFinalTurnAfterMs: 7 * 60 * 1000,
	secondLookMaxMs: 14 * 60 * 1000,
	/** Tasks one lens reviewer may hand to workers on the specialist model. */
	maxDelegationsPerAgent: 3,
	/** A worker answers one narrow question, so it gets few turns. */
	maxWorkerTurns: 6,
	/** One worker's own clock: told to answer after the first, stopped at the second. */
	workerFinalTurnAfterMs: 2 * 60 * 1000,
	workerMaxMs: 3 * 60 * 1000,
	/** Each wave of `maxConcurrentVerifications` verifiers adds this much time. */
	msPerVerificationWave: 5 * 60 * 1000,
	/** Held back from reviewers and subagents so the last verifiers always get to run. */
	reserveMsForVerification: 8 * 60 * 1000
} as const;

/**
 * What a token budget changes in one review: how many reviewers run and how long each may work. Verification is the
 * same at every budget: every valid candidate is re-proven, with the same turns and reserves. Deadlines are the same
 * too, since time limits stop a review rather than save tokens. The subagent cap and the efforts are saved Settings
 * (`TOKEN_BUDGET_PLANS`), not limits.
 */
export interface ReviewLimits {
	/** Reviewers on a small change, and on a larger one (over `REVIEW_POLICY.largeChangeChars`). Each reads one slice and applies every lens. */
	reviewers: { small: number; large: number };
	/**
	 * Turns one reviewer gets. It starts with the first page of its slice and pages the rest itself, so it needs more
	 * than a subagent's few. Every turn re-sends the whole transcript, so the last turns of a long loop cost the most.
	 */
	reviewerTurns: number;
	/** Turns one subagent or second look gets: it follows one question across the repo from scratch. */
	subagentTurns: number;
	/**
	 * The model calls a review gets on top of what its reviewers, subagents and briefs are counted for: workers,
	 * candidate repair and the intent summary. Verifiers add their own as they queue (`VerifyQueue.makeRoom`).
	 */
	maxModelCalls: number;
}

/** The limits of each budget. Low is one reviewer, Medium two or three, High four. */
const BUDGET_LIMITS: Record<TokenBudget, ReviewLimits> = {
	low: { reviewers: { small: 1, large: 1 }, reviewerTurns: 8, subagentTurns: 5, maxModelCalls: 80 },
	medium: { reviewers: { small: 2, large: 3 }, reviewerTurns: 12, subagentTurns: 8, maxModelCalls: 120 },
	high: { reviewers: { small: 4, large: 4 }, reviewerTurns: 16, subagentTurns: 10, maxModelCalls: 160 }
};

/** The limits a review runs with under `budget`. */
export function budgetLimits(budget: TokenBudget): ReviewLimits {
	return BUDGET_LIMITS[budget];
}

/** What a review is planned to run, for sizing its model-call ceiling and deadline. */
export interface ReviewShape {
	reviewers: number;
	/** Brief units (`partitionUnits`), one model call each. */
	briefs: number;
	/** Subagents and second looks the cap allows; an uncapped review is planned as the largest cap. */
	subagents: number;
}

/**
 * The model-call budget and analysis deadline for a review of this shape: the base, plus every call its reviewers,
 * subagents and briefs may make in full, capped. A subagent or reviewer that fails and repairs its answer takes up
 * to `schemaRepairAttempts` more calls, so each is counted with them.
 */
export function scaledReviewLimits(
	shape: ReviewShape,
	limits: ReviewLimits
): { modelCalls: number; deadlineMs: number } {
	const policy = REVIEW_POLICY;
	const repairs = policy.schemaRepairAttempts;

	const calls =
		limits.maxModelCalls +
		shape.briefs +
		shape.reviewers * (limits.reviewerTurns + repairs) +
		shape.subagents * (limits.subagentTurns + repairs);

	return {
		modelCalls: Math.min(policy.maxScaledModelCalls, calls),
		deadlineMs: Math.min(
			policy.maxScaledDeadlineMs,
			policy.analysisDeadlineMs + (shape.reviewers + shape.subagents) * policy.msPerAssignment
		)
	};
}

/** The turn limit of one verifier; a mutation verifier has more because it works in more steps. */
export function verifierTurns(mutation: boolean): number {
	return mutation ? REVIEW_POLICY.maxMutationVerifierTurns : REVIEW_POLICY.maxVerifierTurns;
}
