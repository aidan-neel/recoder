'use client';

import { useSearchParams } from '../shell/navigation';

import { pullTabOf } from '../shell/routes';
import type { PullTab } from './types';

/** The tab the address names (`?tab=review`); null when it names none or one the page does not have. */
export function usePullTab(): PullTab | null {
	return pullTabOf(useSearchParams().get('tab'));
}
