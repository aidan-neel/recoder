'use client';

import { cn, DURATION, EASE_PILL, RowButton } from '@recoder/ui';
import { motion } from 'motion/react';
import { useEffect, useRef, type ReactNode } from 'react';

import { sameSelection, useReview, type Selection } from '@/lib/review/review-store';

/**
 * The highlight's move. A spring settles in about 250ms and trailed a held j
 * by a row, so the bar takes a 100ms tween that keeps up with key repeat.
 */
const TRAVEL = { layout: { duration: DURATION.hover, ease: EASE_PILL } };

interface RailRowProps {
	selection: Selection;
	/** Decided rows dim their title. */
	decided?: boolean;
	className?: string;
	children: ReactNode;
}

/**
 * Brings a row into view by scrolling the rail alone, keeping the row's
 * scroll margin. `scrollIntoView` would also scroll every page around the
 * rail, such as the landing page the site's demo plays in.
 */
function keepInView(row: HTMLElement): void {
	const rail = row.closest<HTMLElement>('[data-ui="review-rail"]');

	if (!rail) return;

	const box = rail.getBoundingClientRect();
	const rect = row.getBoundingClientRect();
	const style = getComputedStyle(row);
	const above = rect.top - (parseFloat(style.scrollMarginTop) || 0) - box.top;
	const below = rect.bottom + (parseFloat(style.scrollMarginBottom) || 0) - box.bottom;

	if (above < 0) rail.scrollTop += above;
	else if (below > 0) rail.scrollTop += Math.min(below, above);
}

/**
 * Keeps a newly selected row in view and, while focus is in the rail, on
 * focus too, so the focus ring and the selection never part (a roving focus,
 * as in a list box). A keyboard move from elsewhere leaves focus where it is.
 */
function useFollowSelection(selected: boolean) {
	const row = useRef<HTMLButtonElement>(null);

	useEffect(() => {
		const element = row.current;

		if (!selected || !element) return;

		keepInView(element);

		const active = document.activeElement;

		if (active !== element && active?.closest('[data-ui="review-rail"]')) element.focus({ preventScroll: true });
	}, [selected]);

	return row;
}

/**
 * One rail row. The selected row carries the rail's single highlight, which
 * travels to the next selected row (layoutId), so a held j or k reads as one
 * moving bar. Under reduced motion the shell's MotionConfig makes it snap.
 * Only the selected row is a Tab stop, so Tab enters the rail on the
 * selection and leaves it for the reading pane. Arrow keys on a focused row
 * walk the rail; Enter and Space on the selected row go to the page (Enter on
 * the Overview starts with the riskiest), while on any other row they select it.
 */
export function RailRow({ selection, decided, className, children }: RailRowProps) {
	const selected = useReview((state) => sameSelection(state.selection, selection));
	const select = useReview((state) => state.select);
	const row = useFollowSelection(selected);

	return (
		<RowButton
			ref={row}
			data-rail-row
			data-selected={selected}
			data-decided={decided}
			data-page-keys={selected ? 'all' : 'move'}
			tabIndex={selected ? 0 : -1}
			aria-current={selected || undefined}
			className={cn('rail-row', className)}
			onClick={() => select(selection)}
		>
			{selected ? (
				<motion.span layoutId="rail-selection" className="rail-selection" aria-hidden transition={TRAVEL} />
			) : null}
			{children}
		</RowButton>
	);
}
