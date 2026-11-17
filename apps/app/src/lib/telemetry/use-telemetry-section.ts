'use client';

import type { TelemetryReport } from '@recoder/shared';

import { useReportSection, type ReportSection } from '../usage/use-report-section';
import { useTelemetry } from './telemetry-store';

/** Reads the telemetry report when Settings → Telemetry opens and for each range picked in the bar. */
export function useTelemetrySection(): ReportSection<TelemetryReport> {
	return useReportSection(useTelemetry, (client) => client.telemetry);
}
