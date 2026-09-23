/**
 * Opening a collapsible changes the height of whatever it lives in. In the
 * review chat that fights the conversation's stick-to-bottom scrolling, and
 * the header you clicked slides away. `anchorToggle` holds the header where it
 * was for the length of the open/close transition, then (when opening) scrolls
 * just enough to bring the new content into view, never past the header.
 */

const HOLD_MS = 320;

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

	const hold = () => {
		const drift = trigger.getBoundingClientRect().top - before;
		if (Math.abs(drift) > 0.5) container.scrollTop += drift;
	};
	// Corrects on scroll too, so a stick-to-bottom scroll is undone before it paints.
	container.addEventListener('scroll', hold);
	const tick = () => {
		hold();
		if (performance.now() < until) {
			requestAnimationFrame(tick);
			return;
		}
		container.removeEventListener('scroll', hold);
		if (opening) reveal();
	};
	requestAnimationFrame(tick);

	function reveal(): void {
		const body = panel();
		if (!body || !container) return;
		const top = container.getBoundingClientRect().top;
		const overflow = body.getBoundingClientRect().bottom - visibleBottom(container) + 16;
		if (overflow <= 0) return;
		const room = trigger.getBoundingClientRect().top - top - 12;
		const by = Math.min(overflow, Math.max(0, room));
		if (by < 1) return;
		const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
		container.scrollBy({ top: by, behavior: reduce ? 'auto' : 'smooth' });
	}
}
