'use client';

import { useLayoutEffect, useState, type RefObject } from 'react';

/** How far outside the viewport an element counts as near, in px, so its content is there before it scrolls in. */
const NEAR_MARGIN = 1200;

/** The element is within the margin of the viewport right now. */
function isNear(element: Element): boolean {
	const box = element.getBoundingClientRect();

	return box.top < window.innerHeight + NEAR_MARGIN && box.bottom > -NEAR_MARGIN;
}

/**
 * True once the element has come near the viewport, and from then on. A long
 * list of heavy items mounts each one's content only when it is about to be
 * seen, and keeps it after. An element that is near when it mounts says so
 * before the first paint, so the page never shows it empty for a frame.
 */
export function useNear(target: RefObject<Element | null>): boolean {
	const [near, setNear] = useState(false);

	useLayoutEffect(() => {
		const element = target.current;

		if (!element || near) return;

		/* eslint-disable-next-line react-hooks/set-state-in-effect -- measured from the layout before the first paint, so a near element never paints empty */
		if (isNear(element)) return setNear(true);

		const observer = new IntersectionObserver(
			(entries) => {
				if (entries.some((entry) => entry.isIntersecting)) setNear(true);
			},
			{ rootMargin: `${NEAR_MARGIN}px 0px` }
		);

		observer.observe(element);

		return () => observer.disconnect();
	}, [target, near]);

	return near;
}
