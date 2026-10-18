'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

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
 */
export function useStickToBottom(resetKey: string) {
	const [viewport, setViewport] = useState<HTMLDivElement | null>(null);
	const [content, setContent] = useState<HTMLDivElement | null>(null);
	const [atBottom, setAtBottom] = useState(true);
	const stuck = useRef(true);

	useEffect(() => {
		if (!viewport) return;

		const element = viewport;
		let lastTop = element.scrollTop;

		function onScroll(): void {
			const top = element.scrollTop;

			if (distanceToEnd(element) <= STICK_PX) stuck.current = true;
			else if (top < lastTop - 1) stuck.current = false;

			lastTop = top;
			setAtBottom(stuck.current);
		}

		element.addEventListener('scroll', onScroll, { passive: true });

		return () => element.removeEventListener('scroll', onScroll);
	}, [viewport]);

	useEffect(() => {
		if (!viewport || !content) return;

		const observer = new ResizeObserver(() => {
			if (stuck.current) pinToEnd(viewport);
		});

		observer.observe(content);
		observer.observe(viewport);

		return () => observer.disconnect();
	}, [viewport, content]);

	useLayoutEffect(() => {
		if (!viewport) return;

		stuck.current = true;
		pinToEnd(viewport);
	}, [viewport, resetKey]);

	/** Scrolls to the end and follows from there: smoothly for the jump button, at once after sending. */
	const toBottom = useCallback(
		(smooth: boolean) => {
			if (!viewport) return;

			stuck.current = true;
			setAtBottom(true);
			viewport.scrollTo({ top: viewport.scrollHeight, behavior: smooth ? 'smooth' : 'instant' });
		},
		[viewport]
	);

	return { attachViewport: setViewport, attachContent: setContent, atBottom, toBottom };
}
