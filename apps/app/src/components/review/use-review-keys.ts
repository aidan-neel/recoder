'use client';

import { decisionCounts, surfaceOf, useReview } from '@/lib/review/review-store';
import type { Outcome } from '@/lib/review/surface';
import { useKeys } from '@/lib/shell/use-keys';

import { scrollReadingPane } from './reading-viewport';

/** The selected decision, if a decision is selected. */
function selectedDecision() {
	const state = useReview.getState();
	const { selection } = state;

	if (selection.kind !== 'decision') return null;

	return surfaceOf(state)?.decisions.find((decision) => decision.id === selection.id) ?? null;
}

/** The keys that decide, and how: a accepts, s sends back, x says it is not an issue. */
export const DECIDE_KEYS = { a: 'accepted', s: 'sent', x: 'dismissed' } as const satisfies Record<string, Outcome>;

/** Decides the selected decision. Only findings can be "not an issue"; questions ignore x. */
export function decideSelected(state: Outcome): void {
	const decision = selectedDecision();

	if (decision && (state !== 'dismissed' || decision.kind === 'finding'))
		useReview.getState().decide(decision.id, state);
}

/** Opens the file the selected decision points at, when the diff has it. */
function openFile(): void {
	const decision = selectedDecision();
	const state = useReview.getState();

	if (decision && surfaceOf(state)?.files.some((file) => file.path === decision.file)) {
		state.select({ kind: 'file', path: decision.file });
	}
}

/**
 * Opens or closes the ask column from any selection: on a decision or a
 * receipt it discusses that item, elsewhere it talks to the orchestrator.
 * The panel puts focus back itself when it closes.
 */
function toggleAsk(): void {
	const { askOpen, setAskOpen } = useReview.getState();

	setAskOpen(!askOpen);
}

function overview(): void {
	useReview.getState().select({ kind: 'overview' });
}

function step(by: number): void {
	useReview.getState().step(by);
}

/**
 * The review page's keys: j, k and the arrows walk the rail; Enter starts
 * with the riskiest from the overview; a, s and x decide; u undoes the last
 * change; h hands off; f opens the file; o and Escape go to the overview;
 * q toggles ask; Space, Page Up, Page Down, Home and End scroll the reading
 * pane while focus rests on the page or the pane.
 */
export function useReviewKeys(): void {
	useKeys({
		j: () => step(1),
		ArrowDown: () => step(1),
		k: () => step(-1),
		ArrowUp: () => step(-1),
		Enter: () => {
			const state = useReview.getState();

			if (state.selection.kind === 'overview') state.select(state.nextOpen(null));
		},
		a: () => decideSelected(DECIDE_KEYS.a),
		s: () => decideSelected(DECIDE_KEYS.s),
		x: () => decideSelected(DECIDE_KEYS.x),
		u: () => {
			useReview.getState().undo();
		},
		h: () => {
			if (decisionCounts(useReview.getState()).sent > 0) useReview.getState().setHandoffOpen(true);
		},
		f: openFile,
		o: overview,
		Escape: overview,
		q: toggleAsk,
		' ': (event) => scrollReadingPane(event.shiftKey ? -1 : 1),
		PageDown: () => scrollReadingPane(1),
		PageUp: () => scrollReadingPane(-1),
		Home: () => scrollReadingPane('start'),
		End: () => scrollReadingPane('end')
	});
}
