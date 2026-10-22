'use client';

import { useEffect, useState } from 'react';

import { stateOf } from '@/lib/review/decisions';
import { plain } from '@/lib/review/labels';
import { decisionCounts, surfaceOf, useReview, type ReviewStore } from '@/lib/review/review-store';
import type { DecisionState } from '@/lib/review/surface';

/** What a change says first, by the state the item is in now. */
const OUTCOME: Record<DecisionState, string> = {
	open: 'Opened again.',
	accepted: 'Accepted.',
	sent: 'Sent back.',
	dismissed: 'Marked not an issue.'
};

/** The one decision whose state changed between two copies of the store; null when none did, or many (a new push). */
function changedDecision(state: ReviewStore, before: ReviewStore): string | null {
	if (state.records === before.records || state.review !== before.review) return null;

	const changed = (surfaceOf(state)?.decisions ?? []).filter(
		(decision) => stateOf(state.records, decision.id) !== stateOf(before.records, decision.id)
	);

	return changed.length === 1 ? changed[0].id : null;
}

/** "Sent back. Next: Refill overshoots capacity, 2 of 4.": the outcome, then where the review now stands. */
function announcement(state: ReviewStore, id: string): string {
	const outcome = OUTCOME[stateOf(state.records, id)];
	const { selection } = state;

	if (selection.kind !== 'decision') {
		return selection.kind === 'overview' && decisionCounts(state).open === 0
			? `${outcome} Every decision is made.`
			: outcome;
	}

	const decisions = surfaceOf(state)?.decisions ?? [];
	const index = decisions.findIndex((decision) => decision.id === selection.id);
	const place = `${plain(decisions[index]?.title ?? '')}, ${index + 1} of ${decisions.length}.`;

	return selection.id === id ? `${outcome} ${place}` : `${outcome} Next: ${place}`;
}

/**
 * True when the person made the change here: it moved the selection (a
 * decision advances, undo selects its item) or touched the selected item (the
 * bar's Undo). A change another tab saved does neither, so it is not read out.
 */
function madeHere(state: ReviewStore, id: string, selectionBefore: ReviewStore['selection']): boolean {
	const { selection } = state;

	return selection !== selectionBefore || (selection.kind === 'decision' && selection.id === id);
}

/**
 * Says each decision, undo and reopen to a screen reader, with where the
 * review moved. The store settles the decision and the move in one task, so
 * the sentence is written once both are in.
 */
export function DecisionAnnouncer() {
	const [said, setSaid] = useState({ text: '', count: 0 });

	useEffect(
		() =>
			useReview.subscribe((state, before) => {
				const id = changedDecision(state, before);

				if (!id) return;

				queueMicrotask(() => {
					const settled = useReview.getState();

					if (madeHere(settled, id, before.selection)) {
						setSaid((last) => ({ text: announcement(settled, id), count: last.count + 1 }));
					}
				});
			}),
		[]
	);

	return (
		<div role="status" className="sr-only">
			<span key={said.count}>{said.text}</span>
		</div>
	);
}
