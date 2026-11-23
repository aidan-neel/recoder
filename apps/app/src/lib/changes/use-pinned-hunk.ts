'use client';

import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react';

import { readOnScroll } from './read-on-scroll';
import { cardAtReadingLine } from './use-current-file';

/** How many frames a pin holds after the cards change, while cards above it mount and settle their height. */
const SETTLE_FRAMES = 30;

/** The card being read and how far below the scroller's top it sat. */
interface Anchor {
	id: string;
	offset: number;
}

/** The hunk card being read, as the outline marks it, and its offset from the scroller's top. */
function readAnchor(host: HTMLElement): Anchor | null {
	const card = cardAtReadingLine(host, 'hunk');

	if (!card?.dataset.hunk) return null;

	return { id: card.dataset.hunk, offset: card.getBoundingClientRect().top - host.getBoundingClientRect().top };
}

/** Scrolls so the anchor's card sits where it sat; false when the card is gone. */
function restore(host: HTMLElement, anchor: Anchor): boolean {
	const card = host.querySelector<HTMLElement>(`[data-hunk="${CSS.escape(anchor.id)}"]`);

	if (!card) return false;

	const drift = card.getBoundingClientRect().top - host.getBoundingClientRect().top - anchor.offset;

	if (Math.abs(drift) >= 1) host.scrollTop += drift;

	return true;
}

/**
 * Keeps the hunk card being read (the one the outline marks) where it is on screen when the guide's cards are
 * replaced, as when the refined guide takes the seed's place and reorders the chapters: it stays at the same
 * height, however much moved above it. It holds for a few frames while the cards above settle, and lets go at once
 * when the person scrolls, presses a key or touches the page.
 */
export function usePinnedHunk(scroller: RefObject<HTMLElement | null>, revision: unknown, on: boolean): void {
	const anchor = useRef<Anchor | null>(null);

	useEffect(() => {
		const host = scroller.current;

		if (!host || !on) return;

		const stop = readOnScroll(host, () => (anchor.current = readAnchor(host)));

		return () => {
			stop();
			anchor.current = null;
		};
	}, [scroller, on]);

	useLayoutEffect(() => {
		const host = scroller.current;
		const held = anchor.current;

		if (!host || !on || !held || !restore(host, held)) return;

		let frame = 0;
		let left = SETTLE_FRAMES;

		function hold(): void {
			if (host && held && left > 0 && restore(host, held)) {
				left -= 1;
				frame = requestAnimationFrame(hold);
			} else stop();
		}

		function stop(): void {
			cancelAnimationFrame(frame);
			left = 0;
			window.removeEventListener('wheel', stop);
			window.removeEventListener('pointerdown', stop);
			window.removeEventListener('keydown', stop);
			window.removeEventListener('touchstart', stop);
		}

		window.addEventListener('wheel', stop, { passive: true });
		window.addEventListener('pointerdown', stop);
		window.addEventListener('keydown', stop);
		window.addEventListener('touchstart', stop, { passive: true });
		frame = requestAnimationFrame(hold);

		return stop;
	}, [scroller, revision, on]);
}
