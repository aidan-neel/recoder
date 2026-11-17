'use client';

import type { ButtonStatus } from '@recoder/ui';
import { useEffect } from 'react';

import { useApi, type ApiClient } from '../api/client';
import { useAction } from '../shell/use-action';
import type { ReportApi, ReportStore } from './report-shared';

/** What a report section shows: the report, a skeleton while it is first read, or why it could not be. */
export type ReportSection<Report> =
	| { view: 'loading' }
	| { view: 'failed'; error: string | null; retry: { status: ButtonStatus; run: () => void } }
	| { view: 'ready'; report: Report };

/** Reads a windowed report when the section opens and for each range picked in the bar, and again from Try again. */
export function useReportSection<Report>(
	store: ReportStore<Report>,
	pickApi: (client: ApiClient) => ReportApi<Report>
): ReportSection<Report> {
	const api = pickApi(useApi());
	const status = store((state) => state.status);
	const report = store((state) => state.report);
	const days = store((state) => state.days);
	const error = store((state) => state.error);
	const retry = useAction();

	useEffect(() => {
		void store.getState().load(api, days);
	}, [store, api, days]);

	if (status === 'error' || status === 'offline') {
		return {
			view: 'failed',
			error,
			retry: { status: retry.status, run: () => retry.run(() => store.getState().load(api, days)) }
		};
	}

	if (status === 'ready' && report) return { view: 'ready', report };

	return { view: 'loading' };
}
