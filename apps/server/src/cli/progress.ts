import type { ReviewAssignment, ReviewBudgetSnapshot, ReviewStage } from '@recoder/shared';

/** What a running review reports, as the command line passes it on. */
export type ProgressEvent =
	| { type: 'stage'; stage: ReviewStage }
	| { type: 'log'; message: string }
	| { type: 'assignment'; assignment: ReviewAssignment }
	| { type: 'budget'; budget: ReviewBudgetSnapshot }
	| { type: 'candidates'; count: number };

/** Receives each event as it happens. It must not throw. */
export type ProgressSink = (event: ProgressEvent) => void;
