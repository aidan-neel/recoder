import type { LinkDoc } from './link-model';

/** The content and the caret at one point in a field's history. */
export interface Snapshot {
	doc: LinkDoc;
	caret: number;
}

/** What an edit did, for grouping: a run of typing or of deleting undoes as one step. */
export type EditKind = 'type' | 'delete' | 'other';

/** A field's undo and redo stacks, and what the last edit was, to group the next one with it. */
export interface History {
	readonly past: readonly Snapshot[];
	readonly future: readonly Snapshot[];
	readonly last: { kind: EditKind; at: number; caret: number } | null;
}

/** Edits further apart than this start a new undo step, as in a native field. */
const GROUP_MS = 1000;

/** The most steps a field keeps. */
const LIMIT = 200;

export const EMPTY_HISTORY: History = { past: [], future: [], last: null };

/**
 * Records an edit. `before` is the state the edit started from and `after`
 * the caret it left. Typing (or deleting) that goes on from where the last
 * edit of its kind left the caret, within a second, joins that step.
 */
export function record(history: History, before: Snapshot, kind: EditKind, caretAfter: number, now: number): History {
	const last = history.last;

	const joins =
		kind !== 'other' &&
		last !== null &&
		last.kind === kind &&
		last.caret === before.caret &&
		now - last.at < GROUP_MS &&
		history.past.length > 0;

	const past = joins ? history.past : [...history.past, before].slice(-LIMIT);

	return { past, future: [], last: { kind, at: now, caret: caretAfter } };
}

/** Steps back: the state to show, and the history with `current` saved for redo. Null when there is nothing to undo. */
export function undo(history: History, current: Snapshot): { snapshot: Snapshot; history: History } | null {
	const snapshot = history.past.at(-1);

	if (!snapshot) return null;

	return {
		snapshot,
		history: { past: history.past.slice(0, -1), future: [...history.future, current], last: null }
	};
}

/** Steps forward again: the state to show, and the history with `current` saved for undo. Null when there is nothing to redo. */
export function redo(history: History, current: Snapshot): { snapshot: Snapshot; history: History } | null {
	const snapshot = history.future.at(-1);

	if (!snapshot) return null;

	return {
		snapshot,
		history: { past: [...history.past, current], future: history.future.slice(0, -1), last: null }
	};
}
