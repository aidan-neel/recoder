'use client';

import { useLayoutEffect, useRef } from 'react';

import { trackHighlight } from './highlight-track';

interface MenuHighlightProps {
	/** Matches the highlighted item inside the parent list. Radix menus and Select mark it `data-highlighted`. */
	selector?: string;
}

/**
 * The traveling highlight every menu-like list shares: one layer under the
 * items that slides to the highlighted one (120ms, ease-out) instead of each
 * item painting its own background. Place it as the first child of the list;
 * kit-menu.css positions that list and keeps the highlight under its rows.
 */
export function MenuHighlight({ selector = '[data-highlighted]' }: MenuHighlightProps) {
	const ref = useRef<HTMLSpanElement>(null);

	useLayoutEffect(() => {
		const highlight = ref.current;
		const list = highlight?.parentElement;

		if (!highlight || !list) return;

		return trackHighlight(highlight, list, selector);
	}, [selector]);

	return <span ref={ref} data-ui="menu-highlight" aria-hidden />;
}
