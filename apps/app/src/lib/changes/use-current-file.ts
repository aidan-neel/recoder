'use client';

import { useEffect, useState, type RefObject } from 'react';

/** How far under the top of the scroller a file's card must reach to count as the one being read. */
const READING_LINE = 72;

/** The path of the last card whose top is above the reading line; the first card's when none is yet. */
function fileAtReadingLine(host: HTMLElement): string | null {
	const line = host.getBoundingClientRect().top + READING_LINE;
	let current: string | null = null;

	for (const card of host.querySelectorAll<HTMLElement>('[data-file]')) {
		if (current !== null && card.getBoundingClientRect().top > line) break;

		current = card.dataset.file ?? null;
	}

	return current;
}

/**
 * The file being read in a scroller of file cards (`[data-file="<path>"]`):
 * the last one whose top passed the reading line. It reads the layout once a
 * frame while the scroller moves, and again when `revision` changes (the
 * cards were replaced).
 */
export function useCurrentFile(scroller: RefObject<HTMLElement | null>, revision: unknown): string | null {
	const [current, setCurrent] = useState<string | null>(null);

	useEffect(() => {
		const host = scroller.current;

		if (!host) return;

		let frame = 0;

		function read(): void {
			frame = 0;
			if (host) setCurrent(fileAtReadingLine(host));
		}

		function onScroll(): void {
			if (!frame) frame = requestAnimationFrame(read);
		}

		read();
		host.addEventListener('scroll', onScroll, { passive: true });

		return () => {
			host.removeEventListener('scroll', onScroll);
			cancelAnimationFrame(frame);
		};
	}, [scroller, revision]);

	return current;
}

/** Scrolls a file's card to the top of its scroller. */
export function scrollToFile(scroller: HTMLElement | null, path: string): void {
	scroller?.querySelector(`[data-file="${CSS.escape(path)}"]`)?.scrollIntoView({ block: 'start' });
}
