'use client';

import type { UsageReport } from '@recoder/shared';

import { useReportSection, type ReportSection } from './use-report-section';
import { useUsage } from './usage-store';

/** Reads the usage report when the section opens and for each range picked in the bar. */
export function useUsageSection(): ReportSection<UsageReport> {
	return useReportSection(useUsage, (client) => client.usage);
}
