import { useSyncExternalStore } from 'react';

/** How far under the top of the window a section's heading counts as reached: the page bar, then some air. */
const REACHED_AT_PX = 96;

/** A section's heading and how far it sits from the top of the window. */
export interface SectionTop {
	id: string;
	top: number;
}

/**
 * Calls `notify` whenever the section in view may have changed: on resize, on a new address hash, and on any
 * scroll, which is the window's on a phone and the page card's on a wider screen. Scroll events do not bubble, so
 * this listens in the capture phase.
 */
function watchScroll(notify: () => void): () => void {
	document.addEventListener('scroll', notify, { capture: true, passive: true });
	window.addEventListener('resize', notify);
	window.addEventListener('hashchange', notify);

	return () => {
		document.removeEventListener('scroll', notify, { capture: true });
		window.removeEventListener('resize', notify);
		window.removeEventListener('hashchange', notify);
	};
}

/** What scrolls the page: the page card on a wide screen, where the frame stays put, and the window on a phone. */
function pageScroller(): Element {
	const card = document.querySelector('.site-card');

	return card && getComputedStyle(card).overflowY !== 'visible' ? card : document.documentElement;
}

/**
 * The section the reader is in: the last one whose heading has passed the
 * reading line, or null above the first. At the end of the page every
 * heading below the top of the window is in view, so the one the reader
 * chose (the address's hash) wins among them, and otherwise the last. Marking
 * the last one regardless sent a choice of an earlier short section, on a
 * window too tall to lift it past the line, to the last section.
 */
export function pickSection(sections: readonly SectionTop[], atEnd: boolean, chosen: string | null): string | null {
	const reached = sections.filter((section) => section.top <= REACHED_AT_PX).at(-1)?.id ?? null;

	if (!atEnd) return reached;

	if (sections.some((section) => section.id === chosen && section.top >= 0)) return chosen;

	return sections.at(-1)?.id ?? null;
}

/** Reads the page: where each section's heading sits, whether the page is scrolled to its end, and the hash. */
function sectionInView(ids: readonly string[]): string | null {
	const scroller = pageScroller();
	const atEnd = scroller.scrollTop > 0 && scroller.clientHeight + scroller.scrollTop >= scroller.scrollHeight - 1;

	const sections = ids.flatMap((id) => {
		const section = document.getElementById(id);

		return section ? [{ id, top: section.getBoundingClientRect().top }] : [];
	});

	return pickSection(sections, atEnd, decodeURIComponent(window.location.hash.slice(1)) || null);
}

/** The id of the page section the reader is in, kept current as the page scrolls; null on the server and above the first section. */
export function useCurrentSection(ids: readonly string[]): string | null {
	return useSyncExternalStore(
		watchScroll,
		() => sectionInView(ids),
		() => null
	);
}
