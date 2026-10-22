'use client';

import { useLayoutEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';

import { rootScale } from '@/lib/shell/root-scale';
import { fitTabs, type TabFitInput } from '@/lib/shell/tab-fit';

/** The search trigger's two widths in shell.css, in CSS px at the base root size. */
const SEARCH_WIDE = 240;
const SEARCH_NARROW = 170;

type Measured = Omit<TabFitInput, 'active'>;

function widthOf(element: Element | undefined): number {
	return element?.getBoundingClientRect().width ?? 0;
}

function gapOf(element: Element): number {
	return Number.parseFloat(getComputedStyle(element).columnGap) || 0;
}

/** The room in the row, and every piece's width from the hidden ruler that renders them all at full size. */
function measure(row: HTMLElement, ruler: HTMLElement): Measured {
	const gap = gapOf(ruler);
	const searchGap = gapOf(row);
	const scale = rootScale();
	const pieces = [...ruler.children].filter((piece): piece is HTMLElement => piece instanceof HTMLElement);
	const piece = (name: string) => pieces.find((element) => element.dataset.measure === name);
	const separator = piece('separator');

	return {
		room: row.clientWidth,
		fixed: widthOf(piece('queue')) + (separator ? widthOf(separator) + gap : 0),
		tabs: pieces
			.filter((element) => element.dataset.measureTab)
			.map((element) => ({ id: element.dataset.measureTab ?? '', width: widthOf(element) + gap })),
		more: widthOf(piece('more')) + gap,
		search: { wide: SEARCH_WIDE * scale + searchGap, narrow: SEARCH_NARROW * scale + searchGap }
	};
}

function same(a: Measured | null, b: Measured): boolean {
	return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Fits the top bar's tabs to its width. `rowRef` goes on the row holding the
 * tab strip and the search trigger, `rulerRef` on the hidden ruler. The fit
 * is null until the first measure, which lands before the first paint, so the
 * bar never shows tabs that do not fit.
 */
export function useTabFit(active: string | null) {
	const rowRef = useRef<HTMLDivElement>(null);
	const rulerRef = useRef<HTMLDivElement>(null);
	const [measured, setMeasured] = useState<Measured | null>(null);

	useLayoutEffect(() => {
		const row = rowRef.current;
		const ruler = rulerRef.current;

		if (!row || !ruler) return;

		const sizes = new ResizeObserver(() => {
			const next = measure(row, ruler);

			flushSync(() => setMeasured((current) => (same(current, next) ? current : next)));
		});

		/** Watches the row and every ruler piece; pieces come and go with the tabs. */
		const watch = () => {
			sizes.disconnect();
			sizes.observe(row);

			for (const element of ruler.children) sizes.observe(element);
		};

		const changes = new MutationObserver(watch);

		watch();
		changes.observe(ruler, { childList: true, subtree: true, characterData: true });

		return () => {
			sizes.disconnect();
			changes.disconnect();
		};
	}, []);

	return { rowRef, rulerRef, fit: measured ? fitTabs({ ...measured, active }) : null };
}
