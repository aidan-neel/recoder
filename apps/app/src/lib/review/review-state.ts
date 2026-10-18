import type { FileDiff, PrCheck, PullRequest, Review, ReviewProgress } from '@recoder/shared';

import { stateOf, type DecisionChange } from './decisions';
import type { Connection } from './review-stream';
import { decisionStates, type DecisionRecord } from './saved-decisions';
import type { Selection } from './selection';
import { buildSurface, type DecisionState } from './surface';

/** How the load went: `offline` never reached the server, `failed` reached it and got an error. */
type LoadStatus = 'loading' | 'ready' | 'missing' | 'offline' | 'failed';

export interface ReviewData {
	id: string;
	sample: boolean;
	status: LoadStatus;
	/** The server's message when the load failed. */
	loadError: string | null;
	review: Review | null;
	files: FileDiff[];
	pull: PullRequest | null;
	repoName: string | null;
	/** True once the pull request and repository lookups have answered, found or not. */
	pullLoaded: boolean;
	/** CI checks on the pull request; null until known, or when the forge has none. */
	checks: PrCheck[] | null;
	/** The live progress snapshot: stage, tasks, reviewers and the conversation. */
	progress: ReviewProgress | null;
	connection: Connection;
	records: Record<string, DecisionRecord>;
	history: DecisionChange[];
	selection: Selection;
	/**
	 * The item a link named (`?item=`) that the page still waits to open; null
	 * once it opened, matched nothing, or the person picked something first.
	 */
	link: string | null;
	handoffOpen: boolean;
	/** The ask-the-reviewer panel beside the reading pane. */
	askOpen: boolean;
}

export const INITIAL: ReviewData = {
	id: '',
	sample: false,
	status: 'loading',
	loadError: null,
	review: null,
	files: [],
	pull: null,
	repoName: null,
	pullLoaded: false,
	checks: null,
	progress: null,
	connection: 'closed',
	records: {},
	history: [],
	selection: { kind: 'overview' },
	link: null,
	handoffOpen: false,
	askOpen: false
};

/** True while the server is still working on the review. */
export function isRunning(review: Review | null): boolean {
	return review?.status === 'queued' || review?.status === 'running';
}

let lastSurface: {
	review: Review;
	files: FileDiff[];
	records: Record<string, DecisionRecord>;
	states: Record<string, DecisionState>;
} | null = null;

let lastResult: ReturnType<typeof buildSurface> | null = null;

/** True when two sets of decision states match item for item. */
function sameStates(a: Record<string, DecisionState>, b: Record<string, DecisionState>): boolean {
	const keys = Object.keys(a);

	return keys.length === Object.keys(b).length && keys.every((id) => a[id] === b[id]);
}

/**
 * The review's decisions, receipts and files, rebuilt only when the review,
 * the diff or a decision's state changes. A note edit keeps the surface, so
 * typing never re-renders what reads it.
 */
export function surfaceOf(state: Pick<ReviewData, 'review' | 'files' | 'records'>) {
	if (!state.review) return null;

	const cached = lastSurface?.review === state.review && lastSurface.files === state.files ? lastSurface : null;

	if (cached?.records === state.records) return lastResult;

	const states = decisionStates(state.records);

	if (cached && sameStates(cached.states, states)) {
		lastSurface = { ...cached, records: state.records };

		return lastResult;
	}

	lastSurface = { review: state.review, files: state.files, records: state.records, states };
	lastResult = buildSurface(state.review, state.files, states);

	return lastResult;
}

/** Overview, then decisions, receipts and files: the order j and k walk. */
export function selectionOrder(state: Pick<ReviewData, 'review' | 'files' | 'records'>): Selection[] {
	const surface = surfaceOf(state);

	if (!surface) return [{ kind: 'overview' }];

	return [
		{ kind: 'overview' },
		...surface.decisions.map((decision) => ({ kind: 'decision' as const, id: decision.id })),
		...surface.receipts.map((receipt) => ({ kind: 'receipt' as const, id: receipt.id })),
		...surface.files.map((file) => ({ kind: 'file' as const, path: file.path }))
	];
}

/** Decisions in each state, plus the total. Select it with `useShallow`, since it returns a new object. */
export function decisionCounts(
	state: Pick<ReviewData, 'review' | 'files' | 'records'>
): Record<DecisionState, number> & { total: number } {
	const counts = { open: 0, accepted: 0, sent: 0, dismissed: 0, total: 0 };

	for (const decision of surfaceOf(state)?.decisions ?? []) {
		counts[stateOf(state.records, decision.id)] += 1;
		counts.total += 1;
	}

	return counts;
}
