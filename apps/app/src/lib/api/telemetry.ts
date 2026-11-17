import type { TelemetryReport, UsageDays } from '@recoder/shared';

import { request } from './http';

/** The telemetry call Settings → Telemetry makes. It is the admin's: a member gets 403 `admin-only`. */
export interface TelemetryApi {
	/** Pull request, review, finding and token telemetry over the last `days` days. */
	report: (days: UsageDays) => Promise<TelemetryReport>;
}

/** The review server's telemetry report. */
export const telemetryApi: TelemetryApi = {
	report: (days) => request<TelemetryReport>(`/api/telemetry?days=${days}`)
};
