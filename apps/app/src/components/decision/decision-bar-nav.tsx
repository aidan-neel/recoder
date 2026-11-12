'use client';

import { AnimatedNumber, Button, Tooltip } from '@recoder/ui';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { memo, type ReactElement } from 'react';

import { sameSelection, selectionOrder, surfaceOf, useReview, type ReviewStore } from '@/lib/review/review-store';
import { useLastShown } from '@/lib/shell/use-last-shown';

/** Where the selected decision sits among the decisions, or null when no decision is selected. */
function selectedIndex(store: ReviewStore): number | null {
	const { selection } = store;

	if (selection.kind !== 'decision') return null;

	const index = surfaceOf(store)?.decisions.findIndex((item) => item.id === selection.id) ?? -1;

	return index >= 0 ? index : null;
}

function decisionTotal(store: ReviewStore): number {
	return surfaceOf(store)?.decisions.length ?? 0;
}

/** True when the selected decision is the last item j reaches, or null when no decision is selected. */
function onLastItem(store: ReviewStore): boolean | null {
	if (store.selection.kind !== 'decision') return null;

	const order = selectionOrder(store);

	return sameSelection(order[order.length - 1], store.selection);
}

function step(by: number): void {
	useReview.getState().step(by);
}

/** A button with a tooltip, wrapped when disabled so the tooltip still has a target that takes pointer events. */
function Tipped({
	label,
	shortcut,
	disabled,
	children
}: {
	label: string;
	shortcut: string;
	disabled: boolean;
	children: ReactElement;
}) {
	return (
		<Tooltip content={label} shortcut={shortcut}>
			{disabled ? <span className="inline-flex">{children}</span> : children}
		</Tooltip>
	);
}

/**
 * "3 of 12". It alone follows the selection, so a step between decisions
 * renders this line and nothing else in the bar; while the bar fades out it
 * keeps the position it had.
 */
function Position() {
	const index = useLastShown(useReview(selectedIndex)) ?? 0;
	const total = useReview(decisionTotal);

	return (
		<span className="mr-1.5 text-[12px] text-fg-faint tabular-nums">
			<AnimatedNumber value={index + 1} still /> of {total}
		</span>
	);
}

/** Next, turned off on the last item j reaches. It renders only when that flips, and keeps its look as the bar fades out. */
function Next() {
	const last = useLastShown(useReview(onLastItem)) ?? false;

	return (
		<Tipped label="Next" shortcut="j" disabled={last}>
			<Button variant="ghost" size="icon" aria-label="Next" disabled={last} onClick={() => step(1)}>
				<ChevronDown />
			</Button>
		</Tipped>
	);
}

/**
 * The bar's end: the position, then Previous and Next. It takes no props, so
 * a new face renders none of it; the position and Next follow the store on
 * their own. Each tooltip mounts its bubble only while it shows.
 */
export const BarNav = memo(function BarNav() {
	return (
		<div className="flex shrink-0 items-center gap-0.5">
			<Position />
			<Tipped label="Previous" shortcut="k" disabled={false}>
				<Button variant="ghost" size="icon" aria-label="Previous" onClick={() => step(-1)}>
					<ChevronUp />
				</Button>
			</Tipped>
			<Next />
		</div>
	);
});
