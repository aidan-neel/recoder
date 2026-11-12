'use client';

import { useSearchParams } from 'next/navigation';

import { PULL_TABS, type PullTab } from './types';

/** True for a tab the page has. */
function isPullTab(value: string | null): value is PullTab {
	return PULL_TABS.some((tab) => tab === value);
}

/** The tab the address names (`?tab=bugs`); Changes when it names none or one the page does not have. */
export function usePullTab(): PullTab {
	const value = useSearchParams().get('tab');

	return isPullTab(value) ? value : 'changes';
}
