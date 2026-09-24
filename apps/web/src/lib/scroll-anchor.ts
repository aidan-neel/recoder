/**
 * Opening a collapsible changes the height of whatever it lives in. In the
 * review chat that fights the conversation's stick-to-bottom scrolling, and
 * the header you clicked slides away. `anchorToggle` holds the header in place
 * while the panel animates. When opening, it also scrolls in step with the
 * growing panel, so the new content comes into view in the same motion (never
 * past the header), instead of a second scroll after the panel finishes.
 */

/** Covers the open/close transition in app.css (.disclosure-panel). */
const HOLD_MS = 360;

function scrollParent(el: HTMLElement): HTMLElement | null {
	for (let node = el.parentElement; node; node = node.parentElement) {
		const overflow = getComputedStyle(node).overflowY;
		if ((overflow === 'auto' || overflow === 'scroll') && node.scrollHeight > node.clientHeight) return node;
	}
	return null;
}

/** Bottom of the visible area: the scroll container, above any floating composer dock over it. */
function visibleBottom(container: HTMLElement): number {
	const bottom = container.getBoundingClientRect().bottom;
	const dock = container.closest('.review-chat')?.querySelector<HTMLElement>('.review-dock');
	return dock ? Math.min(bottom, dock.getBoundingClientRect().top) : bottom;
}

/**
 * Call right before flipping `open`. `panel` returns the element that grows
 * (read after the flip, so it can be conditionally rendered).
 */
export function anchorToggle(trigger: HTMLElement, opening: boolean, panel: () => HTMLElement | null | undefined): void {
	const container = scrollParent(trigger);
	if (!container) return;
	const before = trigger.getBoundingClientRect().top;
	const until = performance.now() + HOLD_MS;

	/** Where the header should sit this frame: held, or lifted just enough to show the panel. */
	const targetTop = (): number => {
		const body = opening ? panel() : null;
		if (!body) return before;
		const top = trigger.getBoundingClientRect().top;
		const bodyBelowTrigger = body.getBoundingClientRect().bottom - top;
		const fit = visibleBottom(container) - 16 - bodyBelowTrigger;
		const ceiling = Math.min(before, container.getBoundingClientRect().top + 12);
		return Math.max(ceiling, Math.min(before, fit));
	};
	const hold = () => {
		const drift = trigger.getBoundingClientRect().top - targetTop();
		if (Math.abs(drift) > 0.5) container.scrollTop += drift;
	};
	// The chat's stick-to-bottom re-pins with scrollTo() on every resize while
	// the panel grows; that would fight the anchor each frame (the page lurches,
	// then snaps back). Mute it on this viewport for the transition only.
	const muted = !Object.prototype.hasOwnProperty.call(container, 'scrollTo');
	if (muted) container.scrollTo = () => {};
	// Corrects on scroll too, so any other scroll is undone before it paints.
	container.addEventListener('scroll', hold);
	const tick = () => {
		hold();
		if (performance.now() < until) {
			requestAnimationFrame(tick);
			return;
		}
		container.removeEventListener('scroll', hold);
		if (muted) delete (container as { scrollTo?: unknown }).scrollTo;
	};
	requestAnimationFrame(tick);
}
