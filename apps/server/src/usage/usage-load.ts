import type { UsageReport, UsageDays } from '@recoder/shared';
import { listMembers } from '../accounts/members';
import { loadPriceLookup } from '../models/model-prices';
import { modelCalls } from '../store';
import { buildUsageReport, type UsageIdentity } from './usage-report';

/**
 * The usage report for the last `days` days, from the recorded model calls, the accounts that
 * could have made them, and the model prices.
 */
export async function loadUsageReport(days: UsageDays, now = new Date()): Promise<UsageReport> {
	const [calls, people, priceOf] = await Promise.all([modelCalls.list(), loadPeople(), loadPriceLookup()]);

	return buildUsageReport({ days, now, calls, people, priceOf });
}

/** The admin and every member who has not been removed. */
async function loadPeople(): Promise<UsageIdentity[]> {
	return (await listMembers()).map((member) => ({
		accountId: member.key,
		role: member.role,
		provider: member.provider,
		host: member.host,
		login: member.login,
		...(member.avatarUrl ? { avatarUrl: member.avatarUrl } : {})
	}));
}
