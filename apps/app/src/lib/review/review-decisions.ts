import { decide, revert, stateOf, withNote, type DecisionChange } from './decisions';
import { sendDismissal } from './dismissal-sync';
import { surfaceOf, type ReviewData } from './review-state';
import { syncTab } from './review-tab';
import { decisionsKey, readDecisions, writeDecisions, type DecisionRecord } from './saved-decisions';
import type { Selection } from './selection';

/** Undo reaches back this many changes. */
const HISTORY_LIMIT = 100;

export interface DecisionActions {
	/** The next open decision after `id`, wrapping; the overview when none is left. */
	nextOpen: (id: string | null) => Selection;
	decide: (id: string, state: DecisionRecord['state']) => void;
	/** Undoes the last change anywhere in the review and selects the item it touched. */
	undo: () => string | null;
	/** Opens one decided item again, keeping its note, as a change the next undo can restore. */
	reopen: (id: string) => void;
	setNote: (id: string, note: string) => void;
}

type Store = ReviewData & DecisionActions & { select: (selection: Selection) => void };

/** What the decision actions reach in the review store. */
interface StoreAccess {
	get: () => Store;
	set: (partial: Partial<ReviewData>) => void;
	/** False while a load keeps its decisions in memory only (the site's demo). */
	persists: () => boolean;
}

/** True when two records say the same thing, or both items are undecided. */
function sameRecord(a: DecisionRecord | undefined, b: DecisionRecord | undefined): boolean {
	return a === b || (!!a && !!b && a.state === b.state && a.note === b.note && a.at === b.at);
}

/**
 * The undo steps that still apply once `saved` replaces `mine`: a step for
 * an item another tab has since changed would overwrite that change, so it
 * goes.
 */
function stillValid(
	history: DecisionChange[],
	mine: Record<string, DecisionRecord>,
	saved: Record<string, DecisionRecord>
) {
	return history.filter((change) => sameRecord(mine[change.id], saved[change.id])).slice(-HISTORY_LIMIT);
}

/** Accept, send back, dismiss, undo and notes, saved per review and head commit. */
export function decisionActions({ get, set, persists }: StoreAccess): DecisionActions {
	/** Tells the server when a finding becomes "not an issue" or stops being one. The sample has no server. */
	function syncDismissal(id: string, was: DecisionRecord['state'], now: DecisionRecord['state']): void {
		const { sample, review } = get();
		const finding = surfaceOf(get())?.decisions.find((decision) => decision.id === id)?.finding;

		if (!sample && review && finding) sendDismissal(review.id, finding.id, was, now);
	}

	/** Saves the records of the items in `ids`, keeping what other tabs saved for the rest, and records the undo steps. */
	function commit(records: Record<string, DecisionRecord>, ids: string[], history: DecisionChange[]): void {
		const { review } = get();
		const saved = review && persists() ? writeDecisions(review.id, review.headSha, records, ids) : records;

		set({ records: saved, history: stillValid(history, records, saved) });
	}

	return {
		nextOpen(id) {
			const { records } = get();
			const decisions = surfaceOf(get())?.decisions ?? [];
			const at = id ? decisions.findIndex((decision) => decision.id === id) : -1;
			const after = [...decisions.slice(at + 1), ...decisions.slice(0, Math.max(at, 0))];
			const next = after.find((decision) => stateOf(records, decision.id) === 'open');

			return next ? { kind: 'decision', id: next.id } : { kind: 'overview' };
		},

		decide(id, state) {
			const { records, history, selection } = get();
			const was = stateOf(records, id);
			const result = decide(records, id, state, Date.now());

			if (!result) return;

			commit(result.records, [id], [...history, result.change]);
			syncDismissal(id, was, state);

			if (selection.kind === 'decision' && selection.id === id) get().select(get().nextOpen(id));

			syncTab(get());
		},

		undo() {
			const { records, history } = get();
			const change = history.at(-1);

			if (!change) return null;

			const was = stateOf(records, change.id);
			const next = revert(records, change);

			commit(next, [change.id], history.slice(0, -1));
			get().select({ kind: 'decision', id: change.id });
			syncDismissal(change.id, was, stateOf(next, change.id));
			syncTab(get());

			return change.id;
		},

		reopen(id) {
			const { records, history } = get();
			const result = decide(records, id, 'open', Date.now());

			if (!result) return;

			commit(result.records, [id], [...history, result.change]);
			syncDismissal(id, stateOf(records, id), 'open');
			syncTab(get());
		},

		setNote(id, note) {
			const { records, history } = get();
			const next = withNote(records, id, note);

			if (next !== records) commit(next, [id], history);
		}
	};
}

/**
 * Follows the decisions another tab saves for the review on screen: the
 * records are read again, and undo steps for the items it changed are
 * dropped. Returns the cleanup.
 */
export function followSavedDecisions({ get, set, persists }: StoreAccess): () => void {
	if (typeof window === 'undefined') return () => {};

	function onStorage(event: StorageEvent): void {
		const { review, records, history } = get();

		if (!review || !persists()) return;
		if (event.key !== null && event.key !== decisionsKey(review.id, review.headSha)) return;

		const saved = readDecisions(review.id, review.headSha);

		set({ records: saved, history: stillValid(history, records, saved) });
		syncTab(get());
	}

	window.addEventListener('storage', onStorage);

	return () => window.removeEventListener('storage', onStorage);
}
