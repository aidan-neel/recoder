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

/** What last drove the page: a key, or a pointer that moved or pressed. */
let lastInput: 'key' | 'pointer' = 'pointer';

/** True once the page-wide listeners that keep {@link lastInput} are in place. */
let watching = false;

/**
 * Notes a pointer that pressed or really moved. A move with no distance is
 * one the browser makes up after a scroll or a layout change, not the person.
 */
function pointerMoved(event: PointerEvent): void {
	if (event.type === 'pointerdown' || event.movementX !== 0 || event.movementY !== 0) lastInput = 'pointer';
}

/** Starts noting, once per page, whether a key or the pointer acted last. */
function watchInput(): void {
	if (watching || typeof document === 'undefined') return;

	const options = { capture: true, passive: true };

	watching = true;
	document.addEventListener('keydown', () => (lastInput = 'key'), options);
	document.addEventListener('pointerdown', pointerMoved, options);
	document.addEventListener('pointermove', pointerMoved, options);
}

/** Shows or hides the highlight; writes only on change, so an observer never wakes for nothing. */
function setState(highlight: HTMLElement, state: 'visible' | 'hidden'): void {
	if (highlight.dataset.state !== state) highlight.dataset.state = state;
}

/**
 * Moves `highlight` onto the item in `container` that matches `selector`, and
 * keeps it there as keyboard and pointer move the highlight. A move the
 * pointer made travels on the CSS transition. A move a key made snaps to its
 * item in the same frame, so a held key never leaves the highlight sliding
 * behind it, and so does the first placement after a hidden spell, which
 * only fades in. A change to the list (an item marked, rows added, removed
 * or re-sorted) moves it in the next animation frame, once for every change
 * that lands before that frame, so it reads the box in the layout that
 * frame's paint needs rather than forcing one after each commit. Returns the
 * cleanup.
 */
export function trackHighlight(highlight: HTMLElement, container: HTMLElement, selector: string): () => void {
	let current: HTMLElement | null = null;
	let hideTimer: number | undefined;
	let frame = 0;

	watchInput();

	/**
	 * Writes the item's box onto the highlight; `travel` false skips the slide.
	 * `data-snap` turns the slide off and stays until the next move that
	 * travels takes it off in the same write: a transition starts from the
	 * style a change ends with, so neither needs a layout read between. The
	 * sides come from insets, which do not transition: the rows of a list
	 * share one width, so a move between them animates only the vertical
	 * offset and the height. Every box is read before the first write, so a
	 * move costs one layout.
	 */
	function place(item: HTMLElement, travel: boolean): void {
		const { x, y } = offsetWithin(item, container);
		const right = container.clientWidth - x - item.offsetWidth;
		const height = item.offsetHeight;

		highlight.toggleAttribute('data-snap', !travel);
		highlight.style.left = `${x}px`;
		highlight.style.right = `${right}px`;
		highlight.style.transform = `translate3d(0, ${y}px, 0)`;
		highlight.style.height = `${height}px`;
		setState(highlight, 'visible');
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
		place(item, current !== null && lastInput === 'pointer');
		current = item;
	}

	/** Syncs in the next animation frame, still before its paint; changes that land before then share the one sync. */
	function schedule(): void {
		if (frame) return;

		frame = requestAnimationFrame(() => {
			frame = 0;
			sync();
		});
	}

	/** A resized list moves its items; the highlight follows without sliding. */
	function refit(): void {
		if (current?.isConnected) place(current, false);
	}

	const mutations = new MutationObserver(schedule);
	const resizes = new ResizeObserver(refit);

	mutations.observe(container, { subtree: true, childList: true, attributes: true, attributeFilter: WATCHED });
	resizes.observe(container);
	sync();

	return () => {
		mutations.disconnect();
		resizes.disconnect();
		cancelAnimationFrame(frame);
		window.clearTimeout(hideTimer);
	};
}
