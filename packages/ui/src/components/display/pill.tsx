'use client';

import type { ReactNode } from 'react';

import { cn } from '../../lib/cn';

/** What a pill reports: a severity, a decision outcome, or a plain label. */
export type PillTone = 'high' | 'medium' | 'low' | 'ok' | 'sent' | 'neutral' | 'danger' | 'info' | 'question';

interface PillProps {
	tone?: PillTone;
	/** `text`: the UI face. `code`: the code face, for a path, a branch, a commit or a command. */
	face?: 'text' | 'code';
	/** A leading icon, drawn at 12px unless it carries its own `size-*` class. */
	icon?: ReactNode;
	/** The full text on hover, for a pill whose text may be cut to fit its row. */
	title?: string;
	children: ReactNode;
	className?: string;
}

/**
 * A small tone label: text on a tint of the same hue. A change of tone
 * crossfades the colors over `--dur-toggle`, so a decided item's pill settles
 * instead of flashing. A pill never grows past its row: its text ends in an
 * ellipsis instead.
 */
export function Pill({ tone = 'neutral', face = 'text', icon, title, children, className }: PillProps) {
	return (
		<span data-ui="pill" data-tone={tone} data-face={face} title={title} className={cn(className)}>
			{icon}
			<span data-ui="pill-text">{children}</span>
		</span>
	);
}
