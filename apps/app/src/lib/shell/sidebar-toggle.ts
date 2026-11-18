import type { FocusEvent } from 'react';

import { narrowQuery, sidebarShown, useChrome } from './chrome';

/** The two halves of the toggle: the sidebar itself, and the page bar's button that brings it back. */
type SidebarPart = 'panel' | 'reveal';

/**
 * Hides or shows the sidebar. The half being hidden turns inert, which would
 * drop keyboard focus inside it onto the page body. A keyboard user's focus
 * there moves to the button that undoes the toggle instead, on the next
 * frame, once React has lifted that button's `inert`. A pointer user's focus
 * is left alone, so no tooltip opens under a mouse that is elsewhere, and the
 * carried focus opens none either (`keepTooltipShutOnCarry`).
 */
export function toggleSidebar(): void {
	const chrome = useChrome.getState();
	const shown = sidebarShown(chrome, narrowQuery()?.matches ?? false);
	const leaving: SidebarPart = shown ? 'panel' : 'reveal';
	const arriving: SidebarPart = shown ? 'reveal' : 'panel';
	const carriesFocus = keyboardFocusIn(leaving);

	chrome.toggleSidebar();

	if (carriesFocus) requestAnimationFrame(() => focusToggleIn(arriving));
}

/** True when keyboard focus (`:focus-visible`) sits inside the given half. */
function keyboardFocusIn(part: SidebarPart): boolean {
	const focused = document.activeElement;

	return !!focused?.closest(`[data-sidebar-part="${part}"]`) && focused.matches(':focus-visible');
}

/** True only while the toggle itself is moving focus to the other half's button. */
let carrying = false;

/** Focuses the toggle button inside the given half. */
function focusToggleIn(part: SidebarPart): void {
	carrying = true;
	document.querySelector<HTMLElement>(`[data-sidebar-part="${part}"] [data-sidebar-toggle]`)?.focus();
	carrying = false;
}

/**
 * For the toggle buttons' tooltips: focus the toggle carried over is not a person asking what the button does,
 * so the tooltip stays shut and never rides the slide or lands on the page beside it.
 */
export function keepTooltipShutOnCarry(event: FocusEvent<HTMLElement>): void {
	if (carrying) event.preventDefault();
}
