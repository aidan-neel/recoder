/** The reading pane's scrolling element: the page's scroll keys move it, and focus lands on it when the pane swaps. */
function readingViewport(): HTMLElement | null {
	return document.querySelector<HTMLElement>('[data-ui="reading-pane"] [data-ui="scroll-area-viewport"]');
}

/**
 * Moves focus to the reading pane, so Space and Page Down scroll it and Tab
 * starts in its content. The person did not tab here, so the pane's keyboard
 * ring stays off until focus leaves it. Returns true when focus landed.
 */
export function focusReadingPane(): boolean {
	const viewport = readingViewport();

	if (!viewport) return false;

	if (document.activeElement !== viewport) {
		viewport.dataset.quietFocus = '';
		viewport.addEventListener('blur', () => delete viewport.dataset.quietFocus, { once: true });
		viewport.focus({ preventScroll: true });
	}

	return document.activeElement === viewport;
}

/**
 * True when focus rests on the page, on the reading pane, or on a rail row
 * (where a click leaves it), so the page's scroll keys apply. Enter and Space
 * on a row that is not selected yet still select it before this is asked.
 */
function scrollKeysApply(viewport: HTMLElement): boolean {
	const active = document.activeElement;

	return !active || active === document.body || active === viewport || !!active.closest('[data-rail-row]');
}

/**
 * Scrolls the reading pane a screen down (1) or up (-1), or to its start or
 * end. A screen keeps the strip the floating decision bar covers. Returns
 * false when focus is elsewhere, so the key keeps its own meaning there.
 */
export function scrollReadingPane(by: 1 | -1 | 'start' | 'end'): boolean {
	const viewport = readingViewport();

	if (!viewport || !scrollKeysApply(viewport)) return false;

	if (by === 'start') viewport.scrollTo({ top: 0 });
	else if (by === 'end') viewport.scrollTo({ top: viewport.scrollHeight });
	else {
		const covered = parseFloat(getComputedStyle(viewport).scrollPaddingBottom) || 0;

		viewport.scrollBy({ top: by * Math.max(viewport.clientHeight - covered, viewport.clientHeight / 2) });
	}

	return true;
}
