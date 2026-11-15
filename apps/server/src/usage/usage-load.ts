import type { UsageReport, UsageDays } from '@recoder/shared';
import { loadPriceLookup } from '../models/model-prices';
import { modelCalls } from '../store';
import { loadReportPeople } from './report-shared';
import { buildUsageReport } from './usage-report';

/**
 * The usage report for the last `days` days, from the recorded model calls, the accounts that
 * could have made them, and the model prices.
 */
export async function loadUsageReport(days: UsageDays, now = new Date()): Promise<UsageReport> {
	const [calls, people, priceOf] = await Promise.all([modelCalls.list(), loadReportPeople(), loadPriceLookup()]);

	return buildUsageReport({ days, now, calls, people, priceOf });
}
