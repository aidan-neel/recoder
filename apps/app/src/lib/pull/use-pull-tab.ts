'use client';

import { useSearchParams } from 'next/navigation';

import { pullTabOf } from '../shell/routes';
import type { PullTab } from './types';

/** The tab the address names (`?tab=review`); Changes when it names none or one the page does not have. */
export function usePullTab(): PullTab {
	return pullTabOf(useSearchParams().get('tab'));
}
