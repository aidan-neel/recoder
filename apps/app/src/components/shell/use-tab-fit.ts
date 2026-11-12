'use client';

import { whenIdle } from '@recoder/ui';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';

import { useReview } from '@/lib/review/review-store';
import { rootScale } from '@/lib/shell/root-scale';
import { QUEUE_TAB } from '@/lib/shell/routes';
import { readSavedMeasure, saveSearchSteps } from '@/lib/shell/saved-bar';
import { useShell } from '@/lib/shell/shell-store';
import { fitPieces, fitTabs, type BarMeasure, type TabFit } from '@/lib/shell/tab-fit';

/** The search trigger's three widths in shell.css, in CSS px at the base root size. */
const SEARCH_WIDE = 240;
const SEARCH_NARROW = 170;
const SEARCH_ICON = 30;

/** The longest a new measure waits for an idle moment before the search sizes it gives are saved. */
const SAVE_WAIT_MS = 2000;

function widthOf(element: Element | undefined): number {
	return element?.getBoundingClientRect().width ?? 0;
}

function gapOf(element: Element): number {
	return Number.parseFloat(getComputedStyle(element).columnGap) || 0;
}

/** The room in the row, and every piece's width from the hidden ruler that renders them all at full size. */
function measure(row: HTMLElement, ruler: HTMLElement): BarMeasure {
	const gap = gapOf(ruler);
	const searchGap = gapOf(row);
	const scale = rootScale();
	const pieces = [...ruler.children].filter((piece): piece is HTMLElement => piece instanceof HTMLElement);
	const piece = (name: string) => widthOf(pieces.find((element) => element.dataset.measure === name));

	return {
		room: row.clientWidth,
		queue: piece('queue'),
		separator: piece('separator') + gap,
		tabs: pieces
			.filter((element) => element.dataset.measureTab)
			.map((element) => ({ id: element.dataset.measureTab ?? '', width: widthOf(element) + gap })),
		more: piece('more') + gap,
		widest: piece('widest') + gap,
		search: {
			wide: SEARCH_WIDE * scale + searchGap,
			narrow: SEARCH_NARROW * scale + searchGap,
			icon: SEARCH_ICON * scale + searchGap
		}
	};
}

function same<T>(a: T, b: T): boolean {
	return JSON.stringify(a) === JSON.stringify(b);
}

/** The measure the bar starts from: the last load's, when it measured the same tabs. */
function savedMeasure(): BarMeasure | null {
	return readSavedMeasure(useShell.getState().tabs);
}

/**
 * The fit of a bar with no review tabs before its first measure: what a wide
 * bar shows. In a narrower one the first measure, before the first paint,
 * shrinks the search. A review page's bar waits for that measure instead,
 * since the room it keeps for the page's tab may bring the separator and the
 * More menu: they then land with the bar, not grow in after it.
 */
const QUEUE_ONLY: TabFit = { visible: [], hidden: [], search: 'wide' };

/**
 * The review page's tab while the bar keeps room for it (`fitPieces`): from
 * the page's first frame until the ruler has measured the tab, which opens
 * as the review loads. A review that settles with no tab (it could not be
 * read), or whose tab the person closed, keeps none.
 */
function useOpening(measured: BarMeasure | null, active: string | null): string | null {
	const review = active !== null && active !== QUEUE_TAB ? active : null;
	const open = useShell((state) => state.tabs.some((tab) => tab.id === review));
	const settled = useReview((state) => state.id === review && state.status !== 'loading');
	const measuredTab = measured?.tabs.some((tab) => tab.id === review) ?? false;

	return review !== null && !measuredTab && (open || !settled) ? review : null;
}

/**
 * The fit for a measure and the page's tab, with room kept for the tab of a
 * review page until it opens. It keeps the last fit's identity while a new
 * measure fits the same way, so the bar's pieces skip their renders when
 * only a width moved.
 */
function useSteadyFit(measured: BarMeasure | null, active: string | null, opening: string | null): TabFit | null {
	const noTabs = useShell((state) => state.tabs.length === 0);

	const fit = useMemo(() => {
		if (measured) return fitTabs({ ...fitPieces(measured, opening), room: measured.room, active });

		return noTabs && opening === null ? QUEUE_ONLY : null;
	}, [measured, active, opening, noTabs]);

	const [steady, setSteady] = useState(fit);

	if (same(fit, steady)) return steady;

	setSteady(fit);

	return fit;
}

/**
 * Keeps the search sizes a measure gives at every window width, once the page
 * is idle, so the next load's boot bar starts at the size this bar settles on.
 */
function useSaveSearchSteps(measured: BarMeasure | null): void {
	useEffect(() => {
		if (!measured) return;

		const { room, ...pieces } = measured;

		return whenIdle(() => saveSearchSteps(pieces, window.innerWidth - room, rootScale()), SAVE_WAIT_MS);
	}, [measured]);
}

/**
 * Fits the top bar's tabs to its width. `rowRef` goes on the row holding the
 * tab strip and the search trigger, `rulerRef` on the hidden ruler. The bar
 * starts from the last load's measure when the tabs are the same, so it
 * mounts with them fitted; with no review tabs it starts as a wide bar;
 * otherwise the fit is null until the first measure. Either way the first
 * measure lands before the first paint, so the bar never shows tabs that do
 * not fit. On a review page whose tab has not opened yet, the fit keeps that
 * tab's room and `opening` names it. The measure reads only inside the resize observer's callback,
 * after the browser's own layout, so it forces none. It renders the bar in
 * that callback only when the fit changes; a width that moves without
 * changing the fit renders after the paint, and the fit keeps its identity,
 * so the bar's pieces skip that render.
 */
export function useTabFit(active: string | null) {
	const rowRef = useRef<HTMLDivElement>(null);
	const rulerRef = useRef<HTMLDivElement>(null);
	const [measured, setMeasured] = useState(savedMeasure);
	const opening = useOpening(measured, active);
	const fit = useSteadyFit(measured, active, opening);
	const shown = useRef({ active, opening, fit });

	useLayoutEffect(() => {
		shown.current = { active, opening, fit };
	});

	useLayoutEffect(() => {
		const row = rowRef.current;
		const ruler = rulerRef.current;

		if (!row || !ruler) return;

		const sizes = new ResizeObserver(() => {
			const next = measure(row, ruler);
			const { active: page, opening, fit: last } = shown.current;
			const unmeasured = next.tabs.some((tab) => tab.id === opening) ? null : opening;
			const update = () => setMeasured((current) => (same(current, next) ? current : next));

			if (same(fitTabs({ ...fitPieces(next, unmeasured), room: next.room, active: page }), last)) update();
			else flushSync(update);
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

	useSaveSearchSteps(measured);

	return { rowRef, rulerRef, fit, opening };
}
