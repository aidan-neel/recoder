'use client';

import { createContext, use, useId, useMemo, type ReactNode } from 'react';

import { Pill, usePillTravel } from './pill';

interface NavPillScopeValue {
	/** The layout id the pills of one nav share. */
	id: string;
	/** False until the nav has painted once; its pill sits still until then. */
	travels: boolean;
}

/** The pill scope of one nav; null outside a `NavPillGroup`. */
const NavPillScope = createContext<NavPillScopeValue | null>(null);

/**
 * Scopes the `NavPill`s inside it to one sliding pill, so two navs on a page,
 * or one nav mounted twice, never trade pills. The pill slides once the nav
 * has painted; its first paint draws it in place. It renders no element.
 */
export function NavPillGroup({ children }: { children: ReactNode }) {
	const id = `${useId()}-nav-pill`;
	const travels = usePillTravel();
	const scope = useMemo(() => ({ id, travels }), [id, travels]);

	return <NavPillScope value={scope}>{children}</NavPillScope>;
}

interface NavPillProps {
	/** The active item's id. The pill slides when it changes, never when the page around it reflows. */
	value: string;
	/**
	 * Corner radius in px, 8 by default. For a fully round pill pass half the
	 * item's height, never more: while the pill slides, motion turns the radius
	 * into percentages of the pill, and a radius far past its size warps the
	 * corners. It is set inline, never in CSS, so the corners stay true while
	 * the pill stretches.
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
	const scope = use(NavPillScope);

	if (!scope) throw new Error('A NavPill must sit inside a NavPillGroup.');

	return (
		<Pill
			layoutId={scope.id}
			ui="nav-pill"
			radius={radius}
			value={value}
			travels={scope.travels}
			className={className}
		/>
	);
}
