import type { UsageDays, UsageReport } from '@recoder/shared';

import { request } from './http';

/** The usage call Settings → Usage makes. It is the admin's: a member gets 403 `admin-only`. */
export interface UsageApi {
	/** Token use per person, model and day over the last `days` days. */
	report: (days: UsageDays) => Promise<UsageReport>;
}

/** The review server's usage report. */
export const usageApi: UsageApi = {
	report: (days) => request<UsageReport>(`/api/usage?days=${days}`)
};
