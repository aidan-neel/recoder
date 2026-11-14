import { useChrome } from './chrome';

/** The two halves of the toggle: the sidebar itself, and the page bar's button that brings it back. */
type SidebarPart = 'panel' | 'reveal';

/**
 * Hides or shows the sidebar. The half being hidden turns inert, which would
 * drop keyboard focus inside it onto the page body. A keyboard user's focus
 * there moves to the button that undoes the toggle instead, on the next
 * frame, once React has lifted that button's `inert`. A pointer user's focus
 * is left alone, so no tooltip opens under a mouse that is elsewhere.
 */
export function toggleSidebar(): void {
	const { sidebarOpen, toggleSidebar: toggle } = useChrome.getState();
	const leaving: SidebarPart = sidebarOpen ? 'panel' : 'reveal';
	const arriving: SidebarPart = sidebarOpen ? 'reveal' : 'panel';
	const carriesFocus = keyboardFocusIn(leaving);

	toggle();

	if (carriesFocus) requestAnimationFrame(() => focusToggleIn(arriving));
}

/** True when keyboard focus (`:focus-visible`) sits inside the given half. */
function keyboardFocusIn(part: SidebarPart): boolean {
	const focused = document.activeElement;

	return !!focused?.closest(`[data-sidebar-part="${part}"]`) && focused.matches(':focus-visible');
}

/** Focuses the toggle button inside the given half. */
function focusToggleIn(part: SidebarPart): void {
	document.querySelector<HTMLElement>(`[data-sidebar-part="${part}"] [data-sidebar-toggle]`)?.focus();
}
