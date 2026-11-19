import { reviewerTools } from '../../../env.js';
import { REVIEW_POLICY, type ReviewLimits } from '../../session/review-policy.js';

/** The share of a model's context window a reviewer without tools may spend on its slice's patch. */
const OPENING_PATCH_SHARE = 0.4;

/** Characters per token, as prompts are sized throughout the pipeline. */
const CHARS_PER_TOKEN = 4;

/** Whether reviewers and subagents may run code and start workers, which they may only with every tool. */
export function reviewersRunCode(): boolean {
	return reviewerTools() === 'all';
}

/**
 * The review's limits as its reviewers' tool setting shapes them. A reviewer without tools answers in one call from its
 * opening message, so the change is cut into slices one message holds and each reviewer and subagent gets a single
 * turn. Subagents still follow up the brief's open questions, each answering in one call from the hunks the question
 * is about, so a question no reviewer settled is looked at again rather than left open. Every other setting leaves
 * the shape alone.
 */
export function limitsForReviewerTools(limits: ReviewLimits): ReviewLimits {
	if (reviewerTools() !== 'none') return limits;

	return { ...limits, reviewerTurns: 1, subagentTurns: 1, sliceChars: REVIEW_POLICY.unitBudgetChars };
}

/**
 * The patch characters a unit agent's opening message may hold. A reviewer without tools cannot page the rest of
 * its slice, so it starts with the whole of it, up to a share of the model's context window; one hunk larger than
 * a slice (a long new file) is the case that needs the room. Undefined leaves the usual first page.
 */
export function openingPatchChars(contextWindow: number): number | undefined {
	if (reviewerTools() !== 'none') return undefined;

	return Math.max(REVIEW_POLICY.maxToolRoundChars, Math.floor(contextWindow * CHARS_PER_TOKEN * OPENING_PATCH_SHARE));
}
