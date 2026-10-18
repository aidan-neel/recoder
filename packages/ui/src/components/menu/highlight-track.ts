/**
 * How long the highlight waits once nothing is highlighted before it fades out.
 * Crossing the 1px gap between two items unhighlights one before the next, and
 * the wait lets the highlight travel across instead of blinking.
 */
const HIDE_DELAY = 60;

/** Attributes the menus flip on the highlighted item: Radix menus and Select, and cmdk. */
const WATCHED = ['data-highlighted', 'data-selected', 'aria-selected', 'hidden'];

/**
 * Where `item` sits inside `container`, in layout pixels. Offsets ignore
 * transforms, so a menu still scaling in from 0.95 measures at full size.
 */
function offsetWithin(item: HTMLElement, container: HTMLElement): { x: number; y: number } {
	let x = 0;
	let y = 0;
	let node: HTMLElement | null = item;

	while (node && node !== container && container.contains(node)) {
		x += node.offsetLeft;
		y += node.offsetTop;
		node = node.offsetParent instanceof HTMLElement ? node.offsetParent : null;
	}

	return { x, y };
}

/** Reads layout, so styles written before it apply at once and the ones after it transition. */
function flushStyles(element: HTMLElement): number {
	return element.offsetWidth;
}

/** Shows or hides the highlight; writes only on change, so an observer never wakes for nothing. */
function setState(highlight: HTMLElement, state: 'visible' | 'hidden'): void {
	if (highlight.dataset.state !== state) highlight.dataset.state = state;
}

/**
 * Moves `highlight` onto the item in `container` that matches `selector`, and
 * keeps it there as keyboard and pointer move the highlight. The first
 * placement after a hidden spell snaps into place and only fades in; later
 * moves travel on the CSS transition. Returns the cleanup.
 */
export function trackHighlight(highlight: HTMLElement, container: HTMLElement, selector: string): () => void {
	let current: HTMLElement | null = null;
	let hideTimer: number | undefined;

	/** Writes the item's box onto the highlight; `travel` false skips the slide for this write. */
	function place(item: HTMLElement, travel: boolean): void {
		const { x, y } = offsetWithin(item, container);

		if (!travel) highlight.setAttribute('data-snap', '');

		highlight.style.transform = `translate3d(${x}px, ${y}px, 0)`;
		highlight.style.width = `${item.offsetWidth}px`;
		highlight.style.height = `${item.offsetHeight}px`;
		setState(highlight, 'visible');

		if (!travel) {
			flushStyles(highlight);
			highlight.removeAttribute('data-snap');
		}
	}

	/** Fades the highlight out once the pointer has left every item. */
	function hide(): void {
		hideTimer = undefined;
		current = null;
		setState(highlight, 'hidden');
	}

	/** Finds the highlighted item and moves to it, or schedules the fade when there is none. */
	function sync(): void {
		const item = container.querySelector<HTMLElement>(selector);

		if (!item) {
			if (current && hideTimer === undefined) hideTimer = window.setTimeout(hide, HIDE_DELAY);

			return;
		}

		window.clearTimeout(hideTimer);
		hideTimer = undefined;
		place(item, current !== null);
		current = item;
	}

	/** A resized list moves its items; the highlight follows without sliding. */
	function refit(): void {
		if (current?.isConnected) place(current, false);
	}

	const mutations = new MutationObserver(sync);
	const resizes = new ResizeObserver(refit);

	mutations.observe(container, { subtree: true, childList: true, attributes: true, attributeFilter: WATCHED });
	resizes.observe(container);
	sync();

	return () => {
		mutations.disconnect();
		resizes.disconnect();
		window.clearTimeout(hideTimer);
	};
}
