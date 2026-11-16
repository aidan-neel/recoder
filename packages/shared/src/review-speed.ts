import type { ReasoningEffort } from './models';

/** How a review runs: the full review, or Spark, a fast one picked per review. */
export const REVIEW_SPEEDS = ['standard', 'spark'] as const;
export type ReviewSpeed = (typeof REVIEW_SPEEDS)[number];

/** What a speed is called, what it trades in a line, and the effort it runs every model at (null: the saved one). */
export interface ReviewSpeedPlan {
	label: string;
	description: string;
	effort: ReasoningEffort | null;
}

export const REVIEW_SPEED_PLANS: Record<ReviewSpeed, ReviewSpeedPlan> = {
	standard: {
		label: 'Standard',
		description: 'Full review: every reviewer and subagent your budget allows, with bugs proven by running code',
		effort: null
	},
	spark: {
		label: 'Spark',
		description: 'Fast review: one reviewer at low effort, no subagents, and code read rather than run',
		effort: 'low'
	}
};
