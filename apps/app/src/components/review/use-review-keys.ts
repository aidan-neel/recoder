'use client';

import { useEffect, useSyncExternalStore } from 'react';

import { decisionCounts, surfaceOf, useReview } from '@/lib/review/review-store';
import type { Outcome } from '@/lib/review/surface';
import type { KeyMap } from '@/lib/shell/keys';
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

/**
 * Steps from presses the browser made while the page still rendered the
 * last step, in order. A held key repeats on its own clock, and while the
 * page renders, its presses wait in the browser; rendering each in turn
 * would keep the selection moving long after the key is let go. These
 * presses only queue their step, so the browser hands over the rest of the
 * waiting presses at once, and the steps apply together in a task after
 * them, rendering once, at the latest selection. Each starts where the one
 * before it stopped, so the ends of the rail hold them as they would one at
 * a time. A press made after the last render ends moves at once, as ever.
 */
let queued: number[] = [];

/** When the page last finished rendering a step, by the clock key presses carry. */
let renderedAt = 0;

/** Notes when the step just taken has rendered: the store's render runs in a microtask queued before this one. */
function noteRendered(): void {
	queueMicrotask(() => (renderedAt = performance.now()));
}

/** Applies the steps waiting, in order; the store's changes in one task render once. */
function applyQueued(): void {
	const steps = queued;

	queued = [];

	for (const by of steps) useReview.getState().step(by);

	noteRendered();
}

/**
 * How long j, k and the arrows count as moving after a press. A held key
 * repeats every 33 to 90 ms, and quick taps come about as often.
 */
const MOVING_MS = 120;

/** True from a j, k or arrow press until the keys have rested {@link MOVING_MS}. */
let moving = false;

let restTimer: ReturnType<typeof setTimeout> | undefined;

const movingListeners = new Set<() => void>();

/** Sets {@link moving} and tells the views that follow it. */
function setMoving(next: boolean): void {
	if (moving === next) return;

	moving = next;

	for (const listener of movingListeners) listener();
}

/** Notes a step's press: the keys move until they rest {@link MOVING_MS}. */
function notePress(): void {
	clearTimeout(restTimer);
	setMoving(true);
	restTimer = setTimeout(() => setMoving(false), MOVING_MS);
}

function subscribeMoving(listener: () => void): () => void {
	movingListeners.add(listener);

	return () => movingListeners.delete(listener);
}

/**
 * True while j, k or the arrows walk the rail, until they rest. The reading
 * pane draws nothing new meanwhile, so the rail keeps up with a held key and
 * no drawing runs into the next press.
 */
export function useKeysMoving(): boolean {
	return useSyncExternalStore(
		subscribeMoving,
		() => moving,
		() => false
	);
}

/** Moves the selection now, or, for a press made while the page rendered the last one, with the presses behind it. */
function step(by: number, event: KeyboardEvent): void {
	notePress();

	if (queued.length === 0 && event.timeStamp >= renderedAt) {
		useReview.getState().step(by);
		noteRendered();

		return;
	}

	if (queued.length === 0) setTimeout(applyQueued, 0);

	queued.push(by);
}

/** `keys` with each handler first applying the steps still waiting, so the key acts on the item they reach. */
function afterSteps(keys: KeyMap): KeyMap {
	return Object.fromEntries(
		Object.entries(keys).map(([key, handler]) => [
			key,
			(event: KeyboardEvent) => {
				if (queued.length > 0) applyQueued();

				return handler(event);
			}
		])
	);
}

/** The keys other than the moves. */
const ACTIONS = afterSteps({
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

/**
 * The review page's keys: j, k and the arrows walk the rail, presses that
 * waited on the page together; Enter starts with the riskiest from the
 * overview; a, s and x decide; u undoes the last change; h hands off; f
 * opens the file; o and Escape go to the overview; q toggles ask; Space,
 * Page Up, Page Down, Home and End scroll the reading pane while focus rests
 * on the page or the pane. Steps still waiting when the page leaves are
 * dropped, and the keys stop moving.
 */
export function useReviewKeys(): void {
	useKeys({
		j: (event) => step(1, event),
		ArrowDown: (event) => step(1, event),
		k: (event) => step(-1, event),
		ArrowUp: (event) => step(-1, event),
		...ACTIONS
	});

	useEffect(
		() => () => {
			queued = [];
			clearTimeout(restTimer);
			setMoving(false);
		},
		[]
	);
}
