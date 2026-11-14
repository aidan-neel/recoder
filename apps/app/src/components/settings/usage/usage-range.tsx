'use client';

import { USAGE_DAYS } from '@recoder/shared';
import { Select } from '@recoder/ui';

import { useUsage } from '@/lib/usage/usage-store';

const OPTIONS = USAGE_DAYS.map((days) => ({ value: String(days), label: `Last ${days} days` }));

/** The window the report covers, in the page's bar. */
export function UsageRange() {
	const days = useUsage((state) => state.days);
	const setDays = useUsage((state) => state.setDays);

	function pick(value: string): void {
		const picked = USAGE_DAYS.find((option) => String(option) === value);

		if (picked) setDays(picked);
	}

	return <Select value={String(days)} onValueChange={pick} options={OPTIONS} align="end" aria-label="Range" />;
}
