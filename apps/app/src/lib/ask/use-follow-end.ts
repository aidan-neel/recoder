'use client';

import { useEffect, useRef, type RefObject } from 'react';

/** How far from the end, in CSS pixels, a person may be and still count as reading the end. */
const END_SLACK = 48;

/**
 * Keeps the end of a conversation in view, the way a chat does: it opens on the newest message, above a composer
 * docked under it, and follows what arrives while the person reads the end. Scrolling up, away from the end, lets
 * them read back undisturbed; scrolling down to the end again, or sending a message, follows once more. The
 * returned ref goes on the element that scrolls; its first child holds the content.
 *
 * A press on a button in the thread (opening a reply's trail, say) also leaves the end, so what the person opens
 * grows in place instead of pulling the view down to the newest line.
 *
 * Only a move up counts as the person leaving: a reply that grows faster than scroll events arrive also puts
 * the end out of reach for a moment, and that must not stop the following. The scroller itself is watched too,
 * so a note or a taller composer that shrinks it never hides the newest line.
 */
export function useFollowEnd(busy: boolean): RefObject<HTMLDivElement | null> {
	const scroller = useRef<HTMLDivElement>(null);
	const following = useRef(true);

	useEffect(() => {
		const element = scroller.current;
		const content = element?.firstElementChild;

		if (!element || !content) return;

		let lastTop = element.scrollTop;

		const showEnd = (): void => {
			if (following.current) element.scrollTop = element.scrollHeight;
		};

		const followWhileAtEnd = (): void => {
			const top = element.scrollTop;
			const away = element.scrollHeight - top - element.clientHeight > END_SLACK;

			if (!away) following.current = true;
			else if (top < lastTop) following.current = false;

			lastTop = top;
		};

		const leaveOnButton = (event: PointerEvent): void => {
			if (event.target instanceof Element && event.target.closest('button')) following.current = false;
		};

		const resized = new ResizeObserver(showEnd);

		resized.observe(content);
		resized.observe(element);
		element.addEventListener('scroll', followWhileAtEnd, { passive: true });
		element.addEventListener('pointerdown', leaveOnButton);

		return () => {
			resized.disconnect();
			element.removeEventListener('scroll', followWhileAtEnd);
			element.removeEventListener('pointerdown', leaveOnButton);
		};
	}, []);

	useEffect(() => {
		const element = scroller.current;

		if (!element || !busy) return;

		following.current = true;
		element.scrollTop = element.scrollHeight;
	}, [busy]);

	return scroller;
}
