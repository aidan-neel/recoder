import type { UsageReport, UsageDays } from '@recoder/shared';
import { loadPriceLookup } from '../models/model-prices';
import { modelCallsInWindow } from '../storage/model-call-reads';
import { loadReportPeople, windowDayKeys } from './report-shared';
import { buildUsageReport } from './usage-report';

/**
 * The usage report for the last `days` days, from the recorded model calls, the accounts that
 * could have made them, and the model prices.
 */
export async function loadUsageReport(days: UsageDays, now = new Date()): Promise<UsageReport> {
	const window = windowDayKeys(now, days);

	const [calls, people, priceOf] = await Promise.all([
		modelCallsInWindow(window[0], window[window.length - 1]),
		loadReportPeople(),
		loadPriceLookup()
	]);

	return buildUsageReport({ days, now, calls, people, priceOf });
}
