'use client';

import { useState } from 'react';

import { useReview } from '@/lib/review/review-store';
import { QUEUE_TAB } from '@/lib/shell/routes';

/**
 * The tab that wears the pill, from the open tabs' ids. A review opened from
 * the queue has no tab until its page loads, so the pill stays on the tab
 * the person came from and slides over once the new tab exists, instead of
 * vanishing and reappearing. A review that fails to load lets the pill go.
 */
export function usePillTab(active: string | null, ids: readonly string[]): string | null {
	const known = active === null || active === QUEUE_TAB || ids.includes(active);

	const failed = useReview((state) => state.id === active && state.status !== 'loading' && state.status !== 'ready');

	const [held, setHeld] = useState(active);

	if (known && held !== active) setHeld(active);

	return known || failed ? active : held;
}
