import { useSyncExternalStore } from 'react';

/** How far under the top of the window a section's heading counts as reached: the page bar, then some air. */
const REACHED_AT_PX = 96;

/**
 * Calls `notify` whenever the section in view may have changed: on resize, and on any scroll, which is the
 * window's on a phone and the page card's on a wider screen. Scroll events do not bubble, so this listens in the
 * capture phase.
 */
function watchScroll(notify: () => void): () => void {
	document.addEventListener('scroll', notify, { capture: true, passive: true });
	window.addEventListener('resize', notify);

	return () => {
		document.removeEventListener('scroll', notify, { capture: true });
		window.removeEventListener('resize', notify);
	};
}

/** What scrolls the page: the page card on a wide screen, where the frame stays put, and the window on a phone. */
function pageScroller(): Element {
	const card = document.querySelector('.site-card');

	return card && getComputedStyle(card).overflowY !== 'visible' ? card : document.documentElement;
}

/**
 * The last section whose top has passed the reading line, or null above the
 * first one. At the end of the page the last section is the one in view,
 * because a short last section never reaches the line.
 */
function sectionInView(ids: readonly string[]): string | null {
	const scroller = pageScroller();
	const atEnd = scroller.scrollTop > 0 && scroller.clientHeight + scroller.scrollTop >= scroller.scrollHeight - 1;

	if (atEnd) return ids.at(-1) ?? null;

	let reached: string | null = null;

	for (const id of ids) {
		const section = document.getElementById(id);

		if (section && section.getBoundingClientRect().top <= REACHED_AT_PX) reached = id;
	}

	return reached;
}

/** The id of the page section the reader is in, kept current as the page scrolls; null on the server and above the first section. */
export function useCurrentSection(ids: readonly string[]): string | null {
	return useSyncExternalStore(
		watchScroll,
		() => sectionInView(ids),
		() => null
	);
}
