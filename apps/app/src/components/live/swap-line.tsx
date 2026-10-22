'use client';

import { cn, SwapText } from '@recoder/ui';

/** Each live line holds for at least this long, so a burst of updates reads as calm swaps. */
const HOLD_MS = 900;

/**
 * One line of live text that crossfades when it changes, holding each value
 * long enough to read. It keeps its height, so a swap never moves what sits
 * around it, and shows the full text on hover when it truncates.
 */
export function SwapLine({ text, className }: { text: string; className?: string }) {
	return (
		<SwapText holdMs={HOLD_MS} titled className={cn('overflow-hidden', className)}>
			{text}
		</SwapText>
	);
}
