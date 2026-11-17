'use client';

import { useTelemetry } from '@/lib/telemetry/telemetry-store';

import { ReportRange } from '../usage/usage-range';

/** The window Settings → Telemetry covers, in the page's bar. */
export function TelemetryRange() {
	return <ReportRange store={useTelemetry} />;
}
