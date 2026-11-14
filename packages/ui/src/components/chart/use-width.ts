'use client';

import { useLayoutEffect, useRef, useState, type RefObject } from 'react';

/** The width of the element, kept current as it resizes. Zero until the first measure. */
export function useWidth<Element extends HTMLElement>(): [RefObject<Element | null>, number] {
	const ref = useRef<Element>(null);
	const [width, setWidth] = useState(0);

	useLayoutEffect(() => {
		const element = ref.current;

		if (!element) return;

		setWidth(element.clientWidth);

		const observer = new ResizeObserver(([entry]) => setWidth(Math.round(entry.contentRect.width)));

		observer.observe(element);

		return () => observer.disconnect();
	}, []);

	return [ref, width];
}
