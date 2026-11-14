import { DEFAULT_USAGE_DAYS, type UsageDays, type UsageReport } from '@recoder/shared';
import { create } from 'zustand';

import { failureText, isOffline } from '../api/http';
import type { UsageApi } from '../api/usage';

/** `offline`: the review server did not answer. `error`: it answered with one. */
type UsageStatus = 'idle' | 'loading' | 'ready' | 'error' | 'offline';

interface UsageStore {
	status: UsageStatus;
	/** The range picked in the page's bar; the report on screen catches up with it as it loads. */
	days: UsageDays;
	/** The last report read. It stays on screen while another range loads. */
	report: UsageReport | null;
	/** The server's reason the last load failed; null when it never answered. */
	error: string | null;
	/** Picks the range; the open section reads its report. */
	setDays: (days: UsageDays) => void;
	/** Reads the report for `days`. A reply for a range the person has since left is dropped. */
	load: (api: UsageApi, days: UsageDays) => Promise<void>;
}

export const useUsage = create<UsageStore>((set, get) => ({
	status: 'idle',
	days: DEFAULT_USAGE_DAYS,
	report: null,
	error: null,

	setDays: (days) => set({ days }),

	async load(api, days) {
		set({ days, ...(get().report ? {} : { status: 'loading' as const }) });

		try {
			const report = await api.report(days);

			if (get().days === days) set({ report, status: 'ready', error: null });
		} catch (error) {
			if (get().days !== days) return;

			set(
				isOffline(error)
					? { status: 'offline', error: null }
					: { status: 'error', error: failureText(error, 'Couldn’t read the usage.') }
			);
		}
	}
}));
