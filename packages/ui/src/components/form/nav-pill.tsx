'use client';

import { createContext, use, useId, type ReactNode } from 'react';

import { Pill } from './pill';

/** The layout id the pills of one nav share; null outside a `NavPillGroup`. */
const NavPillScope = createContext<string | null>(null);

/**
 * Scopes the `NavPill`s inside it to one sliding pill, so two navs on a page,
 * or one nav mounted twice, never trade pills. It renders no element.
 */
export function NavPillGroup({ children }: { children: ReactNode }) {
	const id = `${useId()}-nav-pill`;

	return <NavPillScope value={id}>{children}</NavPillScope>;
}

interface NavPillProps {
	/** The active item's id. The pill slides when it changes, never when the page around it reflows. */
	value: string;
	/**
	 * Corner radius in px, 8 by default. Pass 999 for a fully round pill. It is
	 * set inline, never in CSS, so the corners stay true while the pill stretches.
	 */
	radius?: number;
	/** Restyles the pill (its fill: `bg-menu`). */
	className?: string;
}

/**
 * The fill behind the active item of a nav, such as the top bar's tabs or a
 * settings section list. Render it inside the active item only; it slides in
 * from the old item on the kit spring. It sits under every label in the
 * nearest stacking context, so give the nav `isolation: isolate` (a
 * `HoverList` has it) and keep the items free of `z-index`.
 */
export function NavPill({ value, radius = 8, className }: NavPillProps) {
	const layoutId = use(NavPillScope);

	if (!layoutId) throw new Error('A NavPill must sit inside a NavPillGroup.');

	return <Pill layoutId={layoutId} ui="nav-pill" radius={radius} value={value} className={className} />;
}
