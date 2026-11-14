'use client';

import type { UsageReport } from '@recoder/shared';

import { findActivePerson, usageScope } from '@/lib/usage/usage-model';
import { usePersonFocus } from '@/lib/usage/use-person-focus';
import { useUsagePerson } from '@/lib/usage/use-usage-person';

import { UsageBreakdown } from './usage-breakdown';
import { UsageOverview } from './usage-overview';
import { UsagePersonHeader } from './usage-person-header';
import { UsageKinds } from './usage-kinds';
import { UsageCalls, UsageTotals } from './usage-totals';

/**
 * The usage page once the report is read: the overview (the total, who used
 * it and the daily chart), the totals and the breakdown. One person
 * (`?person=`) is the same page over their part, with their models beside
 * the chart and the way back where the update strip was.
 */
export function UsageReportView({ report }: { report: UsageReport }) {
	const choice = useUsagePerson();
	const person = findActivePerson(report, choice.accountId);
	const scope = usageScope(report, person);

	usePersonFocus(person?.accountId ?? null);

	return (
		<>
			{person ? <UsagePersonHeader person={person} onBack={() => choice.select(null)} /> : null}
			<div className="usage-report">
				<UsageOverview report={report} scope={scope} onSelectPerson={choice.select} />
				<UsageTotals scope={scope} />
				<UsageCalls scope={scope} />
				{person ? null : <UsageKinds report={report} />}
				<UsageBreakdown report={report} scope={scope} onSelectPerson={choice.select} />
			</div>
		</>
	);
}
