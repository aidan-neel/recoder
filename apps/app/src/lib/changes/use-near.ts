'use client';

import { useEffect, useState, type RefObject } from 'react';

/** How far outside the viewport an element counts as near, so its content is there before it scrolls in. */
const NEAR_MARGIN = '1200px 0px';

/**
 * True once the element has come near the viewport, and from then on. A long
 * list of heavy items mounts each one's content only when it is about to be
 * seen, and keeps it after.
 */
export function useNear(target: RefObject<Element | null>): boolean {
	const [near, setNear] = useState(false);

	useEffect(() => {
		const element = target.current;

		if (!element || near) return;

		const observer = new IntersectionObserver(
			(entries) => {
				if (entries.some((entry) => entry.isIntersecting)) setNear(true);
			},
			{ rootMargin: NEAR_MARGIN }
		);

		observer.observe(element);

		return () => observer.disconnect();
	}, [target, near]);

	return near;
}
