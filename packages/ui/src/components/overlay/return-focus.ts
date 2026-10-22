'use client';

import { useCallback, useInsertionEffect, useRef, type RefCallback } from 'react';

/**
 * Where each open kit dialog may send focus when it closes, best first, keyed
 * by its panel. A dialog opened from inside another one that is closing (a
 * palette row that opens a modal) inherits the closing dialog's targets.
 */
const targets = new WeakMap<Element, HTMLElement[]>();

/** The panel of a kit dialog, modal or alert. */
const DIALOG = '[role="dialog"], [role="alertdialog"]';

/**
 * What had focus when each open context menu opened, keyed by its panel. A
 * dropdown names its trigger in `aria-labelledby`; a context menu names
 * nothing, so it records its opener here.
 */
const openers = new WeakMap<Element, Element>();

/** Records what had focus as a context menu opened, so a dialog opened from one of its items can return there. */
export function rememberOpener(menu: Element, opener: Element): void {
	openers.set(menu, opener);
}

/** The element a menu stands for once it closes: a dropdown's trigger, or what had focus as a context menu opened. */
function menuOpener(menu: Element): Element | null {
	const trigger = menu.getAttribute('aria-labelledby');

	return trigger ? document.getElementById(trigger) : (openers.get(menu) ?? null);
}

/**
 * The element focus should return to, given what had focus as the dialog
 * opened. A menu item unmounts with its menu, so it stands for its menu's
 * opener.
 */
function returnTarget(active: Element | null): HTMLElement | null {
	const menu = active?.closest('[role="menu"]');
	const target = menu ? menuOpener(menu) : active;

	return target instanceof HTMLElement && target !== document.body ? target : null;
}

/** Focuses the first element that is still in the page and takes focus; true when one did. */
function focusFirst(candidates: HTMLElement[]): boolean {
	for (const candidate of candidates) {
		if (!candidate.isConnected) continue;

		candidate.focus({ preventScroll: true });

		if (document.activeElement === candidate) return true;
	}

	return false;
}

/**
 * True when something outside the closed panel holds focus: the dialog's
 * action put it there on purpose, as the palette's Ask row does when the ask
 * column focuses its composer. Focus on `<body>` or still inside the panel
 * was not placed by anyone.
 */
function focusMovedOut(panel: EventTarget | null): boolean {
	const active = document.activeElement;

	return active instanceof HTMLElement && active !== document.body && panel instanceof Node && !panel.contains(active);
}

/** What a dialog wires into Radix: a ref for its panel and the close-focus handler for its content. */
export interface ReturnFocus<T extends HTMLElement> {
	panelRef: RefCallback<T>;
	restoreFocus: (event: Event) => void;
}

/**
 * Returns focus to what had it when a controlled dialog opened. Radix only
 * restores focus to its own `Trigger`, and most kit dialogs open from state,
 * so without this focus falls to `<body>` on close. Attach `panelRef` to the
 * dialog panel and pass `restoreFocus` as Radix's `onCloseAutoFocus`. A consumer's
 * own `onCloseAutoFocus` runs first; when it prevents the default, it owns
 * focus. Focus is read in an insertion effect, before the commit can move it:
 * an `autoFocus` field inside the panel takes focus during layout.
 *
 * The closing panel turns inert in the same insertion effect. Radix keeps its
 * focus trap until the commit's passive effects, so without this the trap
 * would pull back focus that the dialog's action moved elsewhere during
 * layout. An inert panel lets go of focus, so after a plain close focus rests
 * on `<body>` while the panel fades, then returns to the opener. When the
 * panel unmounts, focus that sits outside it stays put, and neither the
 * opener nor Radix (the trigger, or `<body>`) takes it.
 */
export function useReturnFocus<T extends HTMLElement>(
	open: boolean,
	onCloseAutoFocus?: (event: Event) => void
): ReturnFocus<T> {
	const candidates = useRef<HTMLElement[]>([]);
	const panel = useRef<T | null>(null);

	useInsertionEffect(() => {
		panel.current?.toggleAttribute('inert', !open);

		if (!open) return;

		const active = document.activeElement;
		const outer = active?.closest(DIALOG);
		const target = returnTarget(active);

		candidates.current = [...(target ? [target] : []), ...((outer && targets.get(outer)) ?? [])];
	}, [open]);

	const panelRef = useCallback((node: T | null) => {
		panel.current = node;

		if (node) targets.set(node, candidates.current);
	}, []);

	const restoreFocus = useCallback(
		(event: Event) => {
			onCloseAutoFocus?.(event);

			if (event.defaultPrevented) return;

			if (focusMovedOut(event.target) || focusFirst(candidates.current)) event.preventDefault();
		},
		[onCloseAutoFocus]
	);

	return { panelRef, restoreFocus };
}
