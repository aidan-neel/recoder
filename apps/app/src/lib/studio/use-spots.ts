'use client';

import { useLayoutEffect, useState, type RefObject } from 'react';

export interface Spot {
	x: number;
	y: number;
	w: number;
	h: number;
}

/** The two measures put every spot in the same place, so the floor need not render again. */
function sameSpots(a: Map<string, Spot>, b: Map<string, Spot>): boolean {
	if (a.size !== b.size) return false;

	for (const [key, spot] of b) {
		const other = a.get(key);

		if (!other || other.x !== spot.x || other.y !== spot.y || other.w !== spot.w || other.h !== spot.h) return false;
	}

	return true;
}

/**
 * Where each `[data-spot]` element sits inside `container`, measured after
 * every layout the key names, on resize, and when a transition inside it
 * ends, so the characters walk between real elements.
 */
export function useSpots(container: RefObject<HTMLElement | null>, layoutKey: string): Map<string, Spot> {
	const [spots, setSpots] = useState<Map<string, Spot>>(new Map());

	useLayoutEffect(() => {
		const root = container.current;

		if (!root) return;

		const measure = () => {
			const origin = root.getBoundingClientRect();
			const next = new Map<string, Spot>();

			for (const element of root.querySelectorAll<HTMLElement>('[data-spot]')) {
				const rect = element.getBoundingClientRect();

				next.set(element.dataset.spot ?? '', {
					x: rect.left - origin.left,
					y: rect.top - origin.top,
					w: rect.width,
					h: rect.height
				});
			}

			setSpots((current) => (sameSpots(current, next) ? current : next));
		};

		measure();

		const observer = new ResizeObserver(measure);

		observer.observe(root);
		root.addEventListener('transitionend', measure);

		return () => {
			observer.disconnect();
			root.removeEventListener('transitionend', measure);
		};
	}, [container, layoutKey]);

	return spots;
}
