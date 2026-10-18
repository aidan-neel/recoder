'use client';

import type { ReactNode } from 'react';

import { cn } from '../../lib/cn';

/** What a pill reports: a severity, a decision outcome, or a plain label. */
export type PillTone = 'high' | 'medium' | 'low' | 'ok' | 'sent' | 'neutral' | 'danger' | 'info' | 'question';

interface PillProps {
	tone?: PillTone;
	/** A leading icon, drawn at 12px unless it carries its own `size-*` class. */
	icon?: ReactNode;
	children: ReactNode;
	className?: string;
}

/**
 * A small tone label: text on a tint of the same hue. A change of tone
 * crossfades the colors over `--dur-toggle`, so a decided item's pill settles
 * instead of flashing.
 */
export function Pill({ tone = 'neutral', icon, children, className }: PillProps) {
	return (
		<span data-ui="pill" data-tone={tone} className={cn(className)}>
			{icon}
			{children}
		</span>
	);
}
