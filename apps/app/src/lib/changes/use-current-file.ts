'use client';

import { useEffect, useState, type RefObject } from 'react';

import { readOnScroll } from './read-on-scroll';

/** The least a file's card must reach under the top of the scroller to count as the one being read. */
const READING_LINE = 72;

/** The share of the scroller's height the reading line sits at, when that is lower than `READING_LINE`. */
const READING_SHARE = 1 / 3;

/** What a card names: its file's path (`data-file`), or a guide hunk's id (`data-hunk`). */
type Reading = 'file' | 'hunk';

/**
 * The last card whose top is above the reading line; the first card when none is yet. The line sits a third of the
 * way down, so a file that fills most of the view is the one being read even while the last line of the file before
 * it is still leaving at the top. The cards stack in order, so it halves the list rather than measuring every card
 * above the line, which it does once a frame while the scroller moves.
 */
export function cardAtReadingLine(host: HTMLElement, attribute: Reading): HTMLElement | null {
	const line = host.getBoundingClientRect().top + Math.max(READING_LINE, host.clientHeight * READING_SHARE);
	const cards = host.querySelectorAll<HTMLElement>(`[data-${attribute}]`);
	let low = 1;
	let high = cards.length;

	while (low < high) {
		const middle = (low + high) >> 1;

		if (cards[middle].getBoundingClientRect().top > line) high = middle;
		else low = middle + 1;
	}

	return cards[low - 1] ?? null;
}

/**
 * The file being read in a scroller of file cards (`[data-file="<path>"]`):
 * the last one whose top passed the reading line. It reads the layout once a
 * frame while the scroller moves, and again when `revision` changes (the
 * cards were replaced). With `attribute` set to `hunk`, it is the id of the guide's hunk card being read.
 */
export function useCurrentFile(
	scroller: RefObject<HTMLElement | null>,
	revision: unknown,
	attribute: Reading = 'file'
): string | null {
	const [current, setCurrent] = useState<string | null>(null);

	useEffect(() => {
		const host = scroller.current;

		if (!host) return;

		return readOnScroll(host, () => setCurrent(cardAtReadingLine(host, attribute)?.dataset[attribute] ?? null));
	}, [scroller, revision, attribute]);

	return current;
}
