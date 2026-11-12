import type { FileDiff, PrCheck, PullRequest, Review, ReviewProgress } from '@recoder/shared';

import { stateOf, type DecisionChange } from './decisions';
import type { ReadFailure } from './review-read';
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
	/**
	 * Why the load failed, once it reached the server or broke in the page:
	 * the kind picks the notice (`timeout`, `server`, or `other` for a review
	 * the page could not show), and the text is the server's words.
	 */
	loadError: ReadFailure | null;
	/**
	 * When the copy on screen was last known to match the server, in ms, set
	 * while a refresh could not reach it; 0 when that time is unknown (a copy
	 * an older page kept), and null while the copy is current.
	 */
	staleSince: number | null;
	review: Review | null;
	files: FileDiff[];
	/** Why the diff did not load, in plain words; null when it loaded or is still on its way. */
	filesError: ReadFailure | null;
	pull: PullRequest | null;
	/** Why the pull request lookup failed, in plain words; null when it answered or the review has no forge. */
	pullError: ReadFailure | null;
	/** True once the pull request lookup answered: with the pull request, a failure, or nothing to read. */
	pullAnswered: boolean;
	repoName: string | null;
	/** CI checks on the pull request; null until known, or when the forge has none. */
	checks: PrCheck[] | null;
	/** Why the CI checks did not load, in plain words, while none have loaded. */
	checksError: ReadFailure | null;
	/**
	 * The CI checks on screen while a later read of them failed: when they
	 * were read, in ms (0 when unknown), and why the read failed; null while
	 * they are current.
	 */
	checksStale: { since: number; failure: ReadFailure } | null;
	/** The live progress snapshot: stage, tasks, reviewers and the conversation. */
	progress: ReviewProgress | null;
	/** True when the stream sent no snapshot in time, so the live views say so instead of waiting. */
	progressFailed: boolean;
	connection: Connection;
	/** Failed attempts in a row to open the live stream; 0 once one opens or the person reconnects. */
	streamFailures: number;
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
	staleSince: null,
	review: null,
	files: [],
	filesError: null,
	pull: null,
	pullError: null,
	pullAnswered: false,
	repoName: null,
	checks: null,
	checksError: null,
	checksStale: null,
	progress: null,
	progressFailed: false,
	connection: 'closed',
	streamFailures: 0,
	records: {},
	history: [],
	selection: { kind: 'overview' },
	link: null,
	handoffOpen: false,
	askOpen: false
};

/** Where the live progress stands: on its way, in, or not sent in time. */
type ProgressStatus = 'waiting' | 'ready' | 'failed';

/** Whether the live progress arrived, for the views that wait on it. */
export function progressStatus(state: Pick<ReviewData, 'progress' | 'progressFailed'>): ProgressStatus {
	if (state.progress) return 'ready';

	return state.progressFailed ? 'failed' : 'waiting';
}

/** True while the server is still working on the review. A list item works too. */
export function isRunning(review: Pick<Review, 'status'> | null): boolean {
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

/**
 * Every item the reading pane can show: the order j and k walk, then the
 * quieted findings, which j and k skip and a person opens from the rail.
 */
export function paneOrder(state: Pick<ReviewData, 'review' | 'files' | 'records'>): Selection[] {
	const quieted = (surfaceOf(state)?.quieted ?? []).flatMap((topic) =>
		topic.decisions.map((decision) => ({ kind: 'decision' as const, id: decision.id }))
	);

	return [...selectionOrder(state), ...quieted];
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
