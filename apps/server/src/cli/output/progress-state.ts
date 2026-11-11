import type { ReviewAssignment, ReviewBudgetSnapshot, ReviewStage } from '@recoder/shared';
import type { ProgressEvent } from '../progress.js';

/** What a running review has reported so far, as the live view draws it. */
export interface ProgressState {
	/** When the review started, in milliseconds since the epoch. */
	startedAt: number;
	/** The stage the review is in; null before the first. */
	stage: ReviewStage | null;
	/** When each stage was first entered. */
	stageStartedAt: Partial<Record<ReviewStage, number>>;
	/** The latest report of each reviewer, subagent and verifier, in the order they first appeared. */
	assignments: ReviewAssignment[];
	/** Possible issues raised so far; null before the first count. */
	candidates: number | null;
	budget: ReviewBudgetSnapshot | null;
}

export function initialProgress(startedAt: number): ProgressState {
	return { startedAt, stage: null, stageStartedAt: {}, assignments: [], candidates: null, budget: null };
}

/** The state after `event`, which arrived at `at`. Log lines change nothing: they are kept in the run's files. */
export function advanceProgress(state: ProgressState, event: ProgressEvent, at: number): ProgressState {
	switch (event.type) {
		case 'stage':
			return {
				...state,
				stage: event.stage,
				stageStartedAt: { [event.stage]: at, ...state.stageStartedAt }
			};
		case 'assignment':
			return { ...state, assignments: withAssignment(state.assignments, event.assignment) };
		case 'candidates':
			return { ...state, candidates: event.count };
		case 'budget':
			return { ...state, budget: event.budget };
		case 'log':
			return state;
	}
}

/** The list with this assignment in the place it first took, or at the end when it is new. */
function withAssignment(assignments: readonly ReviewAssignment[], next: ReviewAssignment): ReviewAssignment[] {
	const isKnown = assignments.some((assignment) => assignment.id === next.id);

	return isKnown
		? assignments.map((assignment) => (assignment.id === next.id ? next : assignment))
		: [...assignments, next];
}
