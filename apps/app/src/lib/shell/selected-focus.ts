'use client';

import { useEffect, useRef, type RefObject } from 'react';

import { QUEUE_TAB } from './routes';

/** The page's selected row: the queue row j and k landed on, or the item the review rail shows. */
const SELECTED = '#app-canvas [aria-current="true"]';

/** A closing dialog leaves the page within its exit; past this many frames the wait gives up. */
const MAX_FRAMES = 40;

/** The top bar's link to the page it shows (the tab on the pill, or the gear on settings), else the Queue tab's link. */
const BAR_LINKS = [
	'[data-ui="top-bar"] a[aria-current="page"]',
	`[data-ui="top-tab-link"][data-tab-id="${QUEUE_TAB}"]`
];

/** Focus the shell moved out of a page it hid: where it was, and where it went. */
export interface ParkedFocus {
	from: HTMLElement;
	to: HTMLElement;
}

/**
 * Moves focus out of the page as the shell hides it under the next page's
 * skeleton, so Tab carries on from the top bar instead of the document's
 * start: to the bar's link for the page on the pill, else the Queue tab.
 * Returns where focus was and went, or null when the page did not hold it.
 */
export function parkFocusInBar(): ParkedFocus | null {
	const from = document.activeElement;

	if (!(from instanceof HTMLElement) || !from.closest('#app-canvas')) return null;

	const to = BAR_LINKS.map((selector) => document.querySelector<HTMLElement>(selector)).find(Boolean);

	if (!to) return null;

	to.focus({ preventScroll: true });

	return { from, to };
}

/**
 * Settles focus the shell parked in the top bar once the skeleton goes, when
 * focus is still there. A navigation that was dropped shows the old page
 * again, and focus goes back where it was; one that landed lets focus fall
 * to the page, so the new page takes it as it does on any arrival (the
 * review's reading pane, the queue's selected row).
 */
export function returnParkedFocus(parked: ParkedFocus | null): void {
	if (!parked || document.activeElement !== parked.to) return;

	if (parked.from.isConnected && parked.from.checkVisibility()) parked.from.focus({ preventScroll: true });
	else parked.to.blur();
}

/** Puts focus on the page's selected row, when focus has fallen to the page itself. */
function focusSelectedRow(): void {
	if (document.activeElement !== document.body) return;

	document.querySelector<HTMLElement>(SELECTED)?.focus({ preventScroll: true });
}

/**
 * Back or Forward brought a different page while focus sat in the top bar,
 * on the control that left the page before (the settings gear, a tab): focus
 * falls to the new page, which takes it as on any arrival (the review's
 * reading pane), and on a page that doesn't, the selected row takes it once
 * the page's own arrival has had its frame. Call it in the commit that shows
 * the page.
 */
export function focusPageFromBar(): void {
	const active = document.activeElement;

	if (!(active instanceof HTMLElement) || !active.closest('[data-ui="top-bar"]')) return;

	active.blur();
	requestAnimationFrame(() => requestAnimationFrame(focusSelectedRow));
}

/** Once the dialog matching `selector` has left the page, sends focus that fell to `<body>` to the selected row. Returns the cleanup. */
function focusSelectedAfterClose(selector: string): () => void {
	let frames = 0;
	let frame = requestAnimationFrame(wait);

	function wait(): void {
		if (document.querySelector(selector) && frames++ < MAX_FRAMES) {
			frame = requestAnimationFrame(wait);

			return;
		}

		focusSelectedRow();
	}

	return () => cancelAnimationFrame(frame);
}

/**
 * Keeps a keyboard user's place when a dialog opened by a shortcut closes.
 * The kit returns focus to whatever had it as the dialog opened; when nothing
 * had (focus rested on the page), focus would fall to `<body>`, so once the
 * dialog matching `selector` has left the page it goes to the selected row
 * instead. `chosenRef` is set when the dialog closed by running one of its
 * rows, which leaves focus to whatever that row opened; it resets each time
 * the dialog opens.
 */
export function useSelectedFocusOnClose(open: boolean, selector: string, chosenRef?: RefObject<boolean>): void {
	const wasOpen = useRef(open);

	useEffect(() => {
		const closed = wasOpen.current && !open;

		wasOpen.current = open;

		if (open && chosenRef) chosenRef.current = false;
		if (!closed || chosenRef?.current) return;

		return focusSelectedAfterClose(selector);
	}, [open, selector, chosenRef]);
}
