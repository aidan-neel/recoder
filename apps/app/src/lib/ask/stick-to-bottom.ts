'use client';

import { useCallback, useLayoutEffect, useRef, useState } from 'react';

/** Within this many pixels of the end, the list counts as read to the bottom and follows new text. */
const STICK_PX = 32;

function distanceToEnd(viewport: HTMLElement): number {
	return viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight;
}

/** Puts the end of the list in view at once. */
function pinToEnd(viewport: HTMLElement): void {
	viewport.scrollTop = viewport.scrollHeight;
}

/**
 * Keeps a scrolling transcript pinned to its end while text streams in,
 * unless the reader scrolled up to read something earlier. Only a scroll
 * upward lets go: content growing under a pinned list moves its end away
 * without anyone scrolling, and must not count. A new `resetKey` (another
 * thread) jumps to the end before paint.
 *
 * The pin runs in the resize observer, whose first report comes after the
 * frame's layout and before its paint, so the end is in view on the first
 * frame. Reading the scroll height in the layout effect instead forced a
 * layout of the whole page inside the commit.
 *
 * The viewport and its content go in refs, so mounting a transcript renders
 * it once. A caller renders both in the same commit as itself, or passes
 * `mounted` false until it does (a transcript held back for a frame), so the
 * layout effect finds them.
 */
export function useStickToBottom(resetKey: string, mounted = true) {
	const viewport = useRef<HTMLDivElement>(null);
	const content = useRef<HTMLDivElement>(null);
	const [atBottom, setAtBottom] = useState(true);
	const stuck = useRef(true);

	useLayoutEffect(() => {
		const element = viewport.current;
		const inner = content.current;

		if (!mounted || !element || !inner) return;

		stuck.current = true;
		setAtBottom(true);

		let lastTop = 0;

		const onScroll = () => {
			const top = element.scrollTop;

			if (distanceToEnd(element) <= STICK_PX) stuck.current = true;
			else if (top < lastTop - 1) stuck.current = false;

			lastTop = top;
			setAtBottom(stuck.current);
		};

		const observer = new ResizeObserver(() => {
			if (stuck.current) pinToEnd(element);

			lastTop = element.scrollTop;
		});

		element.addEventListener('scroll', onScroll, { passive: true });
		observer.observe(inner);
		observer.observe(element);

		return () => {
			element.removeEventListener('scroll', onScroll);
			observer.disconnect();
		};
	}, [resetKey, mounted]);

	/** Scrolls to the end and follows from there: smoothly for the jump button, at once after sending. */
	const toBottom = useCallback((smooth: boolean) => {
		const element = viewport.current;

		if (!element) return;

		stuck.current = true;
		setAtBottom(true);
		element.scrollTo({ top: element.scrollHeight, behavior: smooth ? 'smooth' : 'instant' });
	}, []);

	return { attachViewport: viewport, attachContent: content, atBottom, toBottom };
}
