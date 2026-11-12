'use client';

import { cn, RowButton, Tooltip } from '@recoder/ui';
import { CloudOff } from 'lucide-react';
import { useLayoutEffect, useRef, type ReactNode } from 'react';

import { stateOf } from '@/lib/review/decisions';
import { useUnsavedDismissal } from '@/lib/review/dismissal-sync';
import { sameSelection, useReview, type Selection } from '@/lib/review/review-store';

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
 * The scroll runs in the next animation frame, which still comes before the
 * paint, so a link that opens an item far down the rail paints with that row
 * already in view. Measuring there rather than in the commit reads the
 * layout the paint needs anyway: in the commit that first draws a review it
 * forced a layout of the whole page, which later effects then threw away.
 */
function useFollowSelection(selected: boolean) {
	const row = useRef<HTMLButtonElement>(null);

	useLayoutEffect(() => {
		const element = row.current;

		if (!selected || !element) return;

		const active = document.activeElement;

		if (active !== element && active?.closest('[data-ui="review-rail"]')) element.focus({ preventScroll: true });

		const frame = requestAnimationFrame(() => keepInView(element));

		return () => cancelAnimationFrame(frame);
	}, [selected]);

	return row;
}

/**
 * A quiet mark at the end of a finding's row while its dismissal or restore
 * has not reached the server; the decision itself offers Try again. A
 * finding's decision has the finding's id. It sits apart from the row's text
 * (decision.css), so showing it moves nothing.
 */
function UnsavedMark({ findingId }: { findingId: string }) {
	const reviewId = useReview((store) => store.review?.id);
	const state = useReview((store) => stateOf(store.records, findingId));
	const unsaved = useUnsavedDismissal(reviewId, findingId, state);

	if (!unsaved) return null;

	return (
		<Tooltip content="Not saved">
			<span className="rail-unsaved">
				<CloudOff aria-hidden="true" />
				<span className="sr-only">Not saved</span>
			</span>
		</Tooltip>
	);
}

/**
 * One rail row. The rail's one selection highlight follows the selected
 * row (`data-selected`, see `ReviewRail`) and snaps to it under j and k, so
 * a held key reads as one bar that keeps up. Only the selected row is a Tab
 * stop, so Tab enters the rail on the selection and leaves it for the
 * reading pane. Arrow keys on a focused row walk the rail; Enter and Space
 * on the selected row go to the page (Enter on the Overview starts with the
 * riskiest), while on any other row they select it. A decision's row marks a
 * dismissal the server doesn't have.
 */
export function RailRow({ selection, decided, className, children }: RailRowProps) {
	const selected = useReview((state) => sameSelection(state.selection, selection));
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
			onClick={() => useReview.getState().select(selection)}
		>
			{children}
			{selection.kind === 'decision' ? <UnsavedMark findingId={selection.id} /> : null}
		</RowButton>
	);
}
