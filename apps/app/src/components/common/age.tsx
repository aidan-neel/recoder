'use client';

import { fullTime, longAge, shortAge } from '@/lib/shell/age';
import { useNow } from '@/lib/shell/use-now';

/** How often a relative time catches up with the clock. */
const TICK_MS = 30_000;

interface AgeProps {
	/** An ISO time. Nothing renders when it is missing or no date. */
	at: string | null | undefined;
	/** `short`: `5h`, for rows. `long`: `5 hours ago`, for sentences. */
	form?: 'short' | 'long';
	className?: string;
}

/** A time as how long ago it was, with the full date on hover. It keeps up with the clock. */
export function Age({ at, form = 'short', className }: AgeProps) {
	const now = useNow(TICK_MS);
	const text = form === 'short' ? shortAge(at, now) : longAge(at, now);

	if (!at || !text) return null;

	return (
		<time dateTime={at} title={fullTime(at)} className={className}>
			{text}
		</time>
	);
}
