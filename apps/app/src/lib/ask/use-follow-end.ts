'use client';

import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';

/** How far from the end, in CSS pixels, a person may be and still count as reading the end. */
const END_SLACK = 48;

interface FollowEnd {
	/** Goes on the element that scrolls; its first child holds the content. */
	scroller: RefObject<HTMLDivElement | null>;
	/** True while the end is out of view: the person scrolled up, or opened something that pushed it down. */
	away: boolean;
	/** Brings the end back into view and follows what arrives again. */
	toEnd: () => void;
}

/**
 * Keeps the end of a conversation in view, the way a chat does: it opens on the newest message, above a composer
 * docked under it, and follows what arrives while the person reads the end. Scrolling up, away from the end, lets
 * them read back undisturbed, and `away` says so, for the control that brings them back; scrolling down to the end
 * again, `toEnd`, or sending a message follows once more.
 *
 * A press on a button in the thread (opening a reply's trail, say) also leaves the end, so what the person opens
 * grows in place instead of pulling the view down to the newest line.
 *
 * Only a move up counts as the person leaving: a reply that grows faster than scroll events arrive also puts
 * the end out of reach for a moment, and that must not stop the following. The scroller itself is watched too,
 * so a note or a taller composer that shrinks it never hides the newest line.
 */
export function useFollowEnd(busy: boolean): FollowEnd {
	const scroller = useRef<HTMLDivElement>(null);
	const following = useRef(true);
	const [away, setAway] = useState(false);

	useEffect(() => {
		const element = scroller.current;
		const content = element?.firstElementChild;

		if (!element || !content) return;

		let lastTop = element.scrollTop;

		const distance = (): number => element.scrollHeight - element.scrollTop - element.clientHeight;

		const showEnd = (): void => {
			if (following.current) element.scrollTop = element.scrollHeight;

			setAway(distance() > END_SLACK);
		};

		const followWhileAtEnd = (): void => {
			const top = element.scrollTop;
			const far = distance() > END_SLACK;

			if (!far) following.current = true;
			else if (top < lastTop) following.current = false;

			lastTop = top;
			setAway(far && !following.current);
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

	const toEnd = useCallback(() => {
		const element = scroller.current;

		if (!element) return;

		const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

		following.current = true;
		setAway(false);
		element.scrollTo({ top: element.scrollHeight, behavior: still ? 'auto' : 'smooth' });
	}, []);

	return { scroller, away, toEnd };
}
