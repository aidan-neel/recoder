'use client';

import { motion, type Transition } from 'motion/react';

import { cn } from '../../lib/cn';

interface NavPillProps {
	/** Restyles the fill (its colour: `bg-hover`). */
	className?: string;
	/**
	 * Lets the fill travel: when the active item changes, the pill with this
	 * id moves from the old item to the new one instead of being drawn there.
	 * Leave it out to fill in place, as the apps do.
	 */
	layoutId?: string;
	/** How a travelling pill moves. Only with `layoutId`. */
	transition?: Transition;
}

/**
 * The fill behind the active item of a nav, such as a page's tabs or the
 * site's links. Render it inside the active item only. It is drawn in place
 * unless it has a `layoutId`, and takes the item's own corners. It sits
 * under every label in the nearest stacking context, so give the nav
 * `isolation: isolate` (a `HoverList` has it) and keep the items free of
 * `z-index`.
 */
export function NavPill({ className, layoutId, transition }: NavPillProps) {
	if (!layoutId) return <span aria-hidden data-ui="nav-pill" className={cn(className)} />;

	return (
		<motion.span aria-hidden data-ui="nav-pill" layoutId={layoutId} transition={transition} className={cn(className)} />
	);
}
