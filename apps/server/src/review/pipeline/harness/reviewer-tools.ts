import { agentTools, reviewerTools } from '../../../env.js';
import { REVIEW_POLICY, type ReviewLimits } from '../../session/review-policy.js';
import type { AdaptiveReviewInput } from './types.js';

/** The share of a model's context window a reviewer without tools may spend on its slice's patch. */
const OPENING_PATCH_SHARE = 0.4;

/** Characters per token, as prompts are sized throughout the pipeline. */
const CHARS_PER_TOKEN = 4;

/**
 * The review as its reviewers' tool setting shapes it. A reviewer without tools answers in one call from its
 * opening message, so the change is cut into slices one message holds, each reviewer gets a single turn, and no
 * subagent is sent: a subagent exists to follow a question through the repository with tools. Every other
 * setting leaves the shape alone.
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
 * its slice, and one on its CLI's own tools has no `read_diff` to page it with, so each starts with the whole of
 * it, up to a share of the model's context window; one hunk larger than a slice (a long new file) is the case that
 * needs the room. Undefined leaves the usual first page.
 */
export function openingPatchChars(contextWindow: number): number | undefined {
	if (reviewerTools() !== 'none' && agentTools() !== 'cli') return undefined;

	return Math.max(REVIEW_POLICY.maxToolRoundChars, Math.floor(contextWindow * CHARS_PER_TOKEN * OPENING_PATCH_SHARE));
}
