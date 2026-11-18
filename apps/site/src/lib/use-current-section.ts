import { useSyncExternalStore } from 'react';

/** How far under the top of the window a section's heading counts as reached: the page bar, then some air. */
const REACHED_AT_PX = 96;

/** Calls `notify` whenever the section in view may have changed: on scroll and on resize. */
function watchScroll(notify: () => void): () => void {
	window.addEventListener('scroll', notify, { passive: true });
	window.addEventListener('resize', notify);

	return () => {
		window.removeEventListener('scroll', notify);
		window.removeEventListener('resize', notify);
	};
}

/**
 * The last section whose top has passed the reading line, or null above the
 * first one. At the end of the page the last section is the one in view,
 * because a short last section never reaches the line.
 */
function sectionInView(ids: readonly string[]): string | null {
	const atEnd = window.scrollY > 0 && window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 1;

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
