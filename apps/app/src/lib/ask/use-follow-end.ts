'use client';

import { useEffect, useRef, type RefObject } from 'react';

/** How far from the end, in CSS pixels, a person may be and still count as reading the end. */
const END_SLACK = 48;

/**
 * Keeps the end of a scrolling conversation in view while a message is sent and its reply arrives, so both show
 * above a composer that stays docked under them. Scrolling up, away from the end, stops it, and nothing moves
 * when no message is on its way. The returned ref goes on the element that scrolls; its first child holds the
 * content.
 *
 * Only a move up counts as the person leaving: a reply that grows faster than scroll events arrive also puts
 * the end out of reach for a moment, and that must not stop the following.
 */
export function useFollowEnd(busy: boolean): RefObject<HTMLDivElement | null> {
	const scroller = useRef<HTMLDivElement>(null);
	const following = useRef(false);

	useEffect(() => {
		const element = scroller.current;
		const content = element?.firstElementChild;

		if (!element || !content) return;

		let lastTop = element.scrollTop;

		const showEnd = (): void => {
			if (following.current) element.scrollTop = element.scrollHeight;
		};

		const stopWhenScrolledUp = (): void => {
			const top = element.scrollTop;
			const away = element.scrollHeight - top - element.clientHeight > END_SLACK;

			if (away && top < lastTop) following.current = false;

			lastTop = top;
		};

		const grown = new ResizeObserver(showEnd);

		grown.observe(content);
		element.addEventListener('scroll', stopWhenScrolledUp, { passive: true });

		return () => {
			grown.disconnect();
			element.removeEventListener('scroll', stopWhenScrolledUp);
		};
	}, []);

	useEffect(() => {
		const element = scroller.current;

		if (!element) return;

		if (busy) following.current = true;
		if (following.current) element.scrollTop = element.scrollHeight;
		if (!busy) following.current = false;
	}, [busy]);

	return scroller;
}
