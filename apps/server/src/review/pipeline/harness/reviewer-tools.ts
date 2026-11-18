import { reviewerTools } from '../../../env.js';
import { REVIEW_POLICY, type ReviewLimits } from '../../session/review-policy.js';
import type { AdaptiveReviewInput } from './types.js';

/** The share of a model's context window a reviewer without tools may spend on its slice's patch. */
const OPENING_PATCH_SHARE = 0.4;

/** Characters per token, as prompts are sized throughout the pipeline. */
const CHARS_PER_TOKEN = 4;

/** Whether reviewers and subagents may run code and start workers, which they may only with every tool. */
export function reviewersRunCode(): boolean {
	return reviewerTools() === 'all';
}

/**
 * The review as its reviewers' tool setting shapes it. A reviewer without tools answers in one call from its
 * opening message, so the change is cut into slices one message holds, each reviewer gets a single turn, and no
 * subagent is sent. Subagents with the read tools were measured on the benchmark's quick set (Hy4 Flash, three
 * runs): they published no more planted defects (39, 39, 38 of 65 against 40, 40, 39), used 57% more input tokens
 * and added up to a minute and a half to a review. Every other setting leaves the shape alone.
 */
export function shapedForReviewerTools(
	input: AdaptiveReviewInput,
	limits: ReviewLimits
): { input: AdaptiveReviewInput; limits: ReviewLimits } {
	if (reviewerTools() !== 'none') return { input, limits };

	return {
		input: { ...input, subagentCap: 0 },
		limits: { ...limits, reviewerTurns: 1, sliceChars: REVIEW_POLICY.unitBudgetChars }
	};
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
