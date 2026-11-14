'use client';

import type { UsageReport } from '@recoder/shared';
import type { ButtonStatus } from '@recoder/ui';
import { useEffect } from 'react';

import { useApi } from '../api/client';
import { useAction } from '../shell/use-action';
import { useUsage } from './usage-store';

/** What Settings → Usage shows: the report, a skeleton while it is first read, or why it could not be. */
export type UsageSection =
	| { view: 'loading' }
	| { view: 'failed'; error: string | null; retry: { status: ButtonStatus; run: () => void } }
	| { view: 'ready'; report: UsageReport };

/** Reads the report when the section opens and for each range picked in the bar, and again from Try again. */
export function useUsageSection(): UsageSection {
	const { usage: api } = useApi();
	const status = useUsage((state) => state.status);
	const report = useUsage((state) => state.report);
	const days = useUsage((state) => state.days);
	const error = useUsage((state) => state.error);
	const retry = useAction();

	useEffect(() => {
		void useUsage.getState().load(api, days);
	}, [api, days]);

	if (status === 'error' || status === 'offline') {
		return {
			view: 'failed',
			error,
			retry: { status: retry.status, run: () => retry.run(() => useUsage.getState().load(api, days)) }
		};
	}

	if (status === 'ready' && report) return { view: 'ready', report };

	return { view: 'loading' };
}
