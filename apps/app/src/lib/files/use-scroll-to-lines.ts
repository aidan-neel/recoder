'use client';

import { useEffect, type RefObject } from 'react';

/** How far down the scroller the first flagged line rests, as a share of its height. */
const REST_SHARE = 1 / 3;

/**
 * Scrolls the first flagged line in the scroller to a third of the way down, once `ready`, and again whenever
 * `target` changes, even to an equal value: pressing the same citation twice brings its lines back into view. It
 * moves the scroller only, never the page around it, and it jumps with no motion.
 */
export function useScrollToLines(scroller: RefObject<HTMLElement | null>, ready: boolean, target: unknown): void {
	useEffect(() => {
		const host = scroller.current;
		const line = host?.querySelector('[data-flagged]');

		if (!ready || !host || !line) return;

		const offset = line.getBoundingClientRect().top - host.getBoundingClientRect().top + host.scrollTop;

		host.scrollTo({ top: Math.max(0, offset - host.clientHeight * REST_SHARE), behavior: 'instant' });
	}, [scroller, ready, target]);
}
