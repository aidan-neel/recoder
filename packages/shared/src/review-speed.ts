import type { ReasoningEffort, TokenBudget } from './models';

/** How a review runs: the full review, or Spark, a fast one picked per review. */
export const REVIEW_SPEEDS = ['standard', 'spark'] as const;
export type ReviewSpeed = (typeof REVIEW_SPEEDS)[number];

/**
 * What a speed is called, what it trades in a line, and what it overrides in the saved settings: the effort every
 * model runs at, the budget whose limits the review runs with, and the subagent cap. Null keeps the saved one.
 */
export interface ReviewSpeedPlan {
	label: string;
	description: string;
	effort: ReasoningEffort | null;
	tokenBudget: TokenBudget | null;
	subagentCap: 0 | null;
}

export const REVIEW_SPEED_PLANS: Record<ReviewSpeed, ReviewSpeedPlan> = {
	standard: {
		label: 'Standard',
		description: 'Full review: every reviewer and subagent your budget allows, with bugs proven by running code',
		effort: null,
		tokenBudget: null,
		subagentCap: null
	},
	spark: {
		label: 'Spark',
		description: 'Fast review: one reviewer at low effort, no subagents, and code read rather than run',
		effort: 'low',
		tokenBudget: 'low',
		subagentCap: 0
	}
};
