'use client';

import { motion } from 'motion/react';
import { useEffect, useState } from 'react';

import { cn } from '../../lib/cn';
import { SPRING } from '../../motion/presets';

/**
 * False through a control's first paint, true from the frame after it. A
 * control's pills travel only once it has painted, so the commit that first
 * draws a page mounts a plain span that motion never measures. A stand-in
 * that leaves before then (the boot bar, a page's skeleton) never reads
 * layout as it goes, where a traveling pill reads it on every unmount.
 */
export function usePillTravel(): boolean {
	const [travels, setTravels] = useState(false);

	useEffect(() => {
		let frame = requestAnimationFrame(() => {
			frame = requestAnimationFrame(() => setTravels(true));
		});

		return () => cancelAnimationFrame(frame);
	}, []);

	return travels;
}

interface PillProps {
	/** Shared by every pill of one control, so the pill travels from the old option to the new one. */
	layoutId: string;
	/** The `data-ui` hook for the pill (`segmented-pill`, `nav-pill`). */
	ui: string;
	/** Set inline so the layout animation corrects the corners while the pill stretches. */
	radius: number;
	/** The chosen value. The pill measures and slides only when it changes, never when the page around it reflows. */
	value: string;
	/** From `usePillTravel` in the control: false until the control has painted, and the pill then sits still. */
	travels: boolean;
	className?: string;
}

/**
 * The fill behind the active option. Only the active option renders it; on a
 * change the new one takes over the layout id and slides in from the old one
 * on the spring. The first paint has nothing to slide from, so it just sits,
 * as a plain span until its control has painted. A control that moves (a
 * section above it leaves) carries its pill along without a slide, since
 * only a new `value` lets the pill measure itself. It never crossfades: an
 * old pill still on screen (its item leaving) hides at once, so one solid
 * pill slides.
 */
export function Pill({ layoutId, ui, radius, value, travels, className }: PillProps) {
	if (!travels) return <span aria-hidden data-ui={ui} className={cn(className)} style={{ borderRadius: radius }} />;

	return (
		<motion.span
			aria-hidden
			data-ui={ui}
			layoutId={layoutId}
			layoutDependency={value}
			layoutCrossfade={false}
			transition={SPRING}
			className={cn(className)}
			style={{ borderRadius: radius }}
		/>
	);
}
