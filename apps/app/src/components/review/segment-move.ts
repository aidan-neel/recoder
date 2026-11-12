'use client';

import { DURATION, EASE_OUT, whenIdle } from '@recoder/ui';
import { useReducedMotionConfig } from 'motion/react';
import { useLayoutEffect, useRef, type RefObject } from 'react';

/** A segment's move to its new width: short and easing out, within the keyboard's 150ms. */
const MOVE: KeyframeAnimationOptions = {
	duration: DURATION.swap * 1000,
	easing: `cubic-bezier(${EASE_OUT.join(', ')})`
};

/** The longest a bar drawn for the first time waits, after it paints, for an idle moment to take its widths. */
const FIRST_MEASURE_MS = 500;

/**
 * True when the bar shows. A bar under `display: none`, or in a view the
 * reading pane keeps but skips (`content-visibility: hidden`), is not read:
 * there a read would lay out a subtree that never paints.
 */
function shows(element: HTMLElement): boolean {
	return typeof element.checkVisibility === 'function' ? element.checkVisibility() : element.offsetParent !== null;
}

/** The segments' places and widths, or null while the bar is hidden. */
function measure(element: HTMLElement): DOMRect[] | null {
	if (!shows(element)) return null;

	return [...element.children].map((segment) => segment.getBoundingClientRect());
}

/** Starts each segment at its old place and width and eases it to the new one; a segment that empties goes at once. */
function play(element: HTMLElement, was: DOMRect[], now: DOMRect[]): Animation[] {
	const moves: Animation[] = [];

	[...element.children].forEach((segment, index) => {
		const from = was[index];
		const to = now[index];

		if (!from || !to || to.width === 0 || (from.left === to.left && from.width === to.width)) return;

		const start = `translateX(${from.left - to.left}px) scaleX(${from.width / to.width})`;

		moves.push(segment.animate([{ transform: start }, { transform: 'none' }], MOVE));
	});

	return moves;
}

/**
 * Moves a split bar's segments (its children) to their new widths by
 * transform alone (FLIP): the new layout lands at once, then each segment
 * starts drawn at its old place and width and eases to the new one, so no
 * frame lays out the page. `shares` names the widths; a change of it moves
 * the bar. Nothing here reads layout during React's commit: a change is
 * measured in the next animation frame, which still comes before the paint
 * and reads the layout that paint needs anyway, and a bar drawn for the first
 * time is measured once the page is idle after it paints. A bar shown again
 * after it was hidden takes its widths at once. Reduced motion snaps.
 */
export function useSegmentMove(bar: RefObject<HTMLElement | null>, shares: string): void {
	const reduced = !!useReducedMotionConfig();
	const before = useRef<DOMRect[] | null>(null);
	const running = useRef<Animation[]>([]);
	const drawn = useRef(false);

	useLayoutEffect(
		() => () => {
			before.current = null;
			drawn.current = false;
		},
		[]
	);

	useLayoutEffect(() => {
		const element = bar.current;

		if (!element) return;

		if (!drawn.current) {
			drawn.current = true;

			return whenIdle(() => (before.current = measure(element)), FIRST_MEASURE_MS);
		}

		const frame = requestAnimationFrame(() => {
			for (const animation of running.current) animation.cancel();

			const was = before.current;
			const now = measure(element);

			before.current = now;
			running.current = was && now && !reduced ? play(element, was, now) : [];
		});

		return () => cancelAnimationFrame(frame);
	}, [bar, shares, reduced]);
}
