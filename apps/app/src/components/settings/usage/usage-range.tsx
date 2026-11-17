'use client';

import { USAGE_DAYS } from '@recoder/shared';
import { Select } from '@recoder/ui';

import type { ReportStore } from '@/lib/usage/report-shared';
import { useUsage } from '@/lib/usage/usage-store';

const OPTIONS = USAGE_DAYS.map((days) => ({ value: String(days), label: `Last ${days} days` }));

/** Window selector (`Last 7 / 30 / 90 days`) shared by Usage and Telemetry page headers. */
export function ReportRange<Report>({ store }: { store: ReportStore<Report> }) {
	const days = store((state) => state.days);
	const setDays = store((state) => state.setDays);

	function pick(value: string): void {
		const picked = USAGE_DAYS.find((option) => String(option) === value);

		if (picked) setDays(picked);
	}

	return <Select value={String(days)} onValueChange={pick} options={OPTIONS} align="end" aria-label="Range" />;
}

/** The window the usage report covers, in the page's bar. */
export function UsageRange() {
	return <ReportRange store={useUsage} />;
}
