import type { FocusEvent } from 'react';

import { narrowQuery, sidebarShown, useChrome } from './chrome';

/**
 * Hides or shows the sidebar. Hiding it turns it inert, which would drop keyboard focus inside it onto the page body,
 * so a keyboard user's focus there moves to the topbar's toggle that brings it back, on the next frame. A pointer
 * user's focus is left alone, and the carried focus opens no tooltip (`keepTooltipShutOnCarry`).
 */
export function toggleSidebar(): void {
	const chrome = useChrome.getState();
	const focused = document.activeElement;

	const carriesFocus =
		sidebarShown(chrome, narrowQuery()?.matches ?? false) &&
		!!focused?.closest('.sidebar') &&
		focused.matches(':focus-visible');

	chrome.toggleSidebar();

	if (carriesFocus) requestAnimationFrame(focusTopbarToggle);
}

/** True only while the toggle itself is moving focus to the topbar's button. */
let carrying = false;

/** Focuses the topbar's toggle. */
function focusTopbarToggle(): void {
	carrying = true;
	document.querySelector<HTMLElement>('.topbar [data-sidebar-toggle]')?.focus();
	carrying = false;
}

/**
 * For the toggle's tooltip: focus the toggle carried over is not a person asking what the button does, so the tooltip
 * stays shut.
 */
export function keepTooltipShutOnCarry(event: FocusEvent<HTMLElement>): void {
	if (carrying) event.preventDefault();
}
