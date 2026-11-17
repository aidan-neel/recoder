'use client';

import { cn } from '@recoder/ui';

import { runClock } from '@/lib/shell/age';
import { useNow } from '@/lib/shell/use-now';

/** The time a review has run, ticking each second, in tabular figures so its width holds. */
export function RunClock({ since, className }: { since: string; className?: string }) {
	const now = useNow(1000);

	return <span className={cn('mono tabular', className)}>{runClock(now - Date.parse(since))}</span>;
}
