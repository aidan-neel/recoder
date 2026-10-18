'use client';

import { useState } from 'react';

import { useReview } from '@/lib/review/review-store';
import { QUEUE_TAB } from '@/lib/shell/routes';
import type { ReviewTab } from '@/lib/shell/shell-store';

/**
 * The tab that wears the pill. A review opened from the queue has no tab
 * until its page loads, so the pill stays on the tab the person came from
 * and slides over once the new tab exists, instead of vanishing and
 * reappearing. A review that fails to load lets the pill go.
 */
export function usePillTab(active: string | null, tabs: ReviewTab[]): string | null {
	const known = active === null || active === QUEUE_TAB || tabs.some((tab) => tab.id === active);

	const failed = useReview((state) => state.id === active && state.status !== 'loading' && state.status !== 'ready');

	const [held, setHeld] = useState(active);

	if (known && held !== active) setHeld(active);

	return known || failed ? active : held;
}
