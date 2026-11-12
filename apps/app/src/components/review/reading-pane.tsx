'use client';

import { ScrollArea, whenIdle } from '@recoder/ui';
import { memo, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { useShallow } from 'zustand/react/shallow';

import { DecisionBar } from '@/components/decision/decision-bar';
import { DecisionView } from '@/components/decision/decision-view';
import { FileView } from '@/components/decision/file-view';
import { ReceiptView } from '@/components/decision/receipt-view';
import { ReviewRunning } from '@/components/live/review-running';
import { paneOrder, selectionKey, surfaceOf, useReview } from '@/lib/review/review-store';
import { selectionFromKey } from '@/lib/review/selection';

import { LiveStrip } from './live-strip';
import { OverviewView } from './overview-view';
import { isWorking, usePhase } from './review-view';
import { useKeysMoving } from './use-review-keys';

/**
 * Items drawn ahead, hidden, past the selection in the direction it last
 * moved, so j and k show them at once and a held key finds more than the
 * next one drawn.
 */
const AHEAD = 2;

/** Items drawn ahead on the selection's other side, for the way back. */
const BEHIND = 1;

/** Items seen last that stay drawn, hidden, the selection among them, so going back is instant too. */
const KEPT = 3;

/** The longest the pane waits, after its first paint, for an idle moment to draw the neighbours. */
const AHEAD_AFTER_MS = 1500;

/** What the pane shows for one item. While reviewers work and nothing is found yet, the overview is the live view. */
const PaneView = memo(function PaneView({ itemKey, live }: { itemKey: string; live: boolean }) {
	const selection = selectionFromKey(itemKey);

	if (selection.kind === 'decision') return <DecisionView id={selection.id} />;
	if (selection.kind === 'receipt') return <ReceiptView id={selection.id} />;
	if (selection.kind === 'file') return <FileView path={selection.path} />;

	return live ? <ReviewRunning /> : <OverviewView />;
});

/**
 * One view the pane keeps. The shown one takes its place; the rest are
 * skipped (`content-visibility: hidden`): no space, no paint, no focus and
 * no place in the accessibility tree, while their layout is kept, so showing
 * one again lays out nothing new. A view first drawn hidden is laid out once
 * as it mounts, in the background render that draws it and before any paint,
 * so its first showing is as quick.
 */
const PaneSlot = memo(function PaneSlot({ item, shown, live }: { item: string; shown: boolean; live: boolean }) {
	const slot = useRef<HTMLDivElement>(null);

	useLayoutEffect(() => {
		const element = slot.current;

		if (!element) return;

		if (!element.hasAttribute('data-shown')) element.getBoundingClientRect();

		element.dataset.laidOut = '';
	}, []);

	return (
		<div ref={slot} data-pane-view={item} data-shown={shown || undefined}>
			<PaneView itemKey={item} live={live} />
		</div>
	);
});

/**
 * False until the page goes idle after its first paint. The neighbours wait
 * for it, so drawing them ahead never competes with the page's first
 * render, nor restarts each time the review's late parts land.
 */
function useSettled(): boolean {
	const [settled, setSettled] = useState(false);

	useEffect(() => (settled ? undefined : whenIdle(() => setSettled(true), AHEAD_AFTER_MS)), [settled]);

	return settled;
}

/** Where the pane stands as the selection moves. */
interface Trail {
	/** The views shown last, the latest first. */
	seen: string[];
	/** The selection as of the last render. */
	key: string;
	/** True when the move to `key` went back up the rail. */
	back: boolean;
	/** The selection while its view, not drawn when it was chosen, is drawn before any neighbour; else null. */
	first: string | null;
}

/** `items` still in the rail, once each, in rail order, as one string a deferred value can compare. */
function inOrder(items: string[], order: string[]): string {
	const kept = new Set(items.filter((item) => order.includes(item)));

	return JSON.stringify([...kept].sort((a, b) => order.indexOf(a) - order.indexOf(b)));
}

/** What the pane draws: the views it keeps, in rail order, and the one of them it shows. */
interface PaneDraw {
	kept: string[];
	shown: string;
}

/**
 * The views the pane keeps and the one it shows. It wants the selection,
 * its neighbours (once the page has settled; more of them in the direction
 * the selection last moved) and the views shown last, and draws them in a
 * background render. Every kept view is laid out, and only the shown one
 * takes space and paints, so a move to a kept view flips which one shows and
 * lays out nothing new. A move to a view not drawn yet keeps the one on
 * screen until a background render has drawn it alone, then swaps once and
 * draws its neighbours after that paint, so a key press or a click never
 * waits on a view's render and the rail answers at once. While j, k or the
 * arrows move ({@link useKeysMoving}) nothing new is drawn, and a background
 * render under way gives up, so no drawing runs into the next press and the
 * rail keeps up with a held key: the pane shows each kept view the
 * selection passes, and the selection's own view, then its neighbours, once
 * the keys rest.
 */
function usePaneDraw(key: string): PaneDraw {
	const order = useReview(useShallow((state) => paneOrder(state).map(selectionKey)));
	const settled = useSettled();
	const moving = useKeysMoving();
	const [trail, setTrail] = useState<Trail>({ seen: [key], key, back: false, first: null });
	const [asked, setAsked] = useState(() => inOrder([key], order));
	const ready = useDeferredValue(asked);
	const drawn = useMemo(() => JSON.parse(ready) as string[], [ready]);
	const at = order.indexOf(key);
	const moved = key !== trail.key;
	const first = moved ? (drawn.includes(key) ? null : key) : trail.first;
	const back = moved ? at < order.indexOf(trail.key) : trail.back;
	const last = trail.seen[0];
	const shown = drawn.includes(key) ? key : drawn.includes(last) && order.includes(last) ? last : key;
	const [before, after] = back ? [AHEAD, BEHIND] : [BEHIND, AHEAD];
	const near = at < 0 || !settled || first === key ? [] : order.slice(Math.max(at - before, 0), at + after + 1);
	const wanted = inOrder([...trail.seen, shown, key, ...near], order);
	const target = moving ? ready : wanted;

	if (asked !== target) setAsked(target);

	if (moved || shown !== last) {
		setTrail({ seen: [shown, ...trail.seen.filter((other) => other !== shown)].slice(0, KEPT), key, back, first });
	}

	useEffect(() => {
		if (first === null || shown !== first) return;

		const frame = requestAnimationFrame(() => setTrail((now) => (now.first === first ? { ...now, first: null } : now)));

		return () => cancelAnimationFrame(frame);
	}, [first, shown]);

	const kept = drawn.filter((item) => order.includes(item));

	return { kept: kept.includes(shown) ? kept : (JSON.parse(inOrder([...kept, shown], order)) as string[]), shown };
}

/** True when focus is on nothing, or inside a view that no longer shows, so it has to land somewhere. */
function focusDropped(): boolean {
	const active = document.activeElement;

	return !active || active === document.body || !!active.closest('[data-pane-view]:not([data-shown])');
}

/**
 * Opens each newly shown view at the pane's top, with no scroll animation.
 * The check runs in the next animation frame, which still comes before the
 * paint: there it reads the layout the paint needs anyway, where in the
 * commit it forced one, and a pane already at its top is left alone. When a
 * control inside the pane opened the item (`openedRef`: `pending` while the
 * click runs, then the item it selected, until that item's view shows),
 * focus, dropped with the old view, goes to the pane.
 */
function useOpenAtTop(
	viewport: RefObject<HTMLDivElement | null>,
	shown: string,
	openedRef: RefObject<string | null>
): void {
	const lastRef = useRef(shown);

	useLayoutEffect(() => {
		const element = viewport.current;
		const opened = openedRef.current;
		const moved = lastRef.current !== shown;

		lastRef.current = shown;

		if (!element || !moved) return;

		if ((opened === 'pending' || opened === shown) && focusDropped()) element.focus({ preventScroll: true });

		openedRef.current = null;

		const frame = requestAnimationFrame(() => {
			if (element.scrollTop > 0) element.scrollTo({ top: 0, behavior: 'instant' });
		});

		return () => cancelAnimationFrame(frame);
	}, [viewport, shown, openedRef]);
}

/**
 * Makes the pane's scroller a stop for the keyboard: it takes focus (with a
 * ring) and lets the page's arrows and j/k walk the rail through it, while
 * Space and Page Down scroll it.
 */
const VIEWPORT = { tabIndex: 0, role: 'region', 'aria-label': 'Reading pane', 'data-page-keys': 'move' };

/**
 * The views the pane keeps, inside its scroller. Only this follows the
 * selection, so a move re-renders the slot list and the two slots that
 * swap, never the scroll area and its bars around them. When a control
 * inside the pane opens another item (a receipt, the file, the riskiest
 * decision), the control goes away with the old view, so focus moves to the
 * pane instead of dropping to the page.
 */
function PaneViews({ viewport, live }: { viewport: RefObject<HTMLDivElement | null>; live: boolean }) {
	const key = useReview((state) => selectionKey(state.selection));
	const openedRef = useRef<string | null>(null);
	const { kept, shown } = usePaneDraw(key);

	/** Remembers that a control inside the pane was pressed, and then which item it opened, until that item shows. */
	function onClickCapture(): void {
		openedRef.current = 'pending';

		setTimeout(() => {
			if (openedRef.current === 'pending') openedRef.current = selectionKey(useReview.getState().selection);
		});
	}

	useOpenAtTop(viewport, shown, openedRef);

	return (
		<div onClickCapture={onClickCapture}>
			{kept.map((item) => (
				<PaneSlot key={item} item={item} shown={item === shown} live={item === 'overview' && live} />
			))}
		</div>
	);
}

/**
 * The reading pane. Each selection opens at its top and swaps in at once,
 * with no scroll or fade, whether the keyboard or the pointer chose it: the
 * items next to the selection are already drawn and laid out, skipped until
 * shown, so showing one renders and lays out nothing new (`PaneSlot`). A
 * running review with decisions keeps a live strip on top; the decision bar
 * floats over the bottom while a decision is selected. It takes no props,
 * follows no selection and counts decisions without their states, so neither
 * a move nor a decision re-renders it or its scroller (`PaneViews` follows
 * the selection).
 */
export const ReadingPane = memo(function ReadingPane() {
	const phase = usePhase();
	const total = useReview((state) => surfaceOf(state)?.decisions.length ?? 0);
	const viewport = useRef<HTMLDivElement | null>(null);
	const working = isWorking(phase);

	return (
		<div data-ui="reading-pane" className="review-main">
			{working && phase !== 'draft' && total > 0 ? <LiveStrip /> : null}
			<ScrollArea className="flex-1" viewportRef={viewport} viewportProps={VIEWPORT} viewportClassName="review-scroll">
				<PaneViews viewport={viewport} live={working && total === 0} />
			</ScrollArea>
			<DecisionBar />
		</div>
	);
});
