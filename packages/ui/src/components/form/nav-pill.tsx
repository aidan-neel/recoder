import { cn } from '../../lib/cn';

interface NavPillProps {
	/** Restyles the fill (its colour: `bg-hover`). */
	className?: string;
}

/**
 * The fill behind the active item of a nav, such as a page's tabs or the
 * site's links. Render it inside the active item only. It is drawn in place,
 * never slid from the old item, and takes the item's own corners. It sits
 * under every label in the nearest stacking context, so give the nav
 * `isolation: isolate` (a `HoverList` has it) and keep the items free of
 * `z-index`.
 */
export function NavPill({ className }: NavPillProps) {
	return <span aria-hidden data-ui="nav-pill" className={cn(className)} />;
}
