'use client';

import type { ReportPerson, UsageReport } from '@recoder/shared';
import type { ReactNode } from 'react';

import { findActivePerson, usageScope } from '@/lib/usage/usage-model';
import { usePersonFocus } from '@/lib/usage/use-person-focus';
import { useUsagePerson } from '@/lib/usage/use-usage-person';

import { UsageBreakdown } from './usage-breakdown';
import { UsageOverview } from './usage-overview';
import { UsagePersonHeader } from './usage-person-header';
import { UsageKinds } from './usage-kinds';
import { UsageCalls, UsageTotals } from './usage-totals';

/**
 * The overview's key for the everyone view. The overview remounts when the
 * view changes, so a line highlighted in one view (a person) never dims the
 * other view's lines (their models), where no line has that id.
 */
const EVERYONE = 'everyone';

/**
 * The usage page once the report is read: the overview (the total, who used
 * it and the daily chart), the totals and the breakdown.
 */
export function UsageReportView({ report }: { report: UsageReport }) {
	return (
		<ReportPersonFrame findPerson={(accountId) => findActivePerson(report, accountId)}>
			{(person, select, viewKey) => {
				const scope = usageScope(report, person);

				return (
					<>
						<UsageOverview key={viewKey} report={report} scope={scope} onSelectPerson={select} />
						<UsageTotals scope={scope} />
						<UsageCalls scope={scope} />
						{person ? null : <UsageKinds report={report} />}
						<UsageBreakdown report={report} scope={scope} onSelectPerson={select} />
					</>
				);
			}}
		</ReportPersonFrame>
	);
}

interface ReportPersonFrameProps<Person extends ReportPerson> {
	findPerson: (accountId: string | null) => Person | null;
	children: (person: Person | null, selectPerson: (accountId: string) => void, viewKey: string) => ReactNode;
}

/** Shared `?person=` URL drill-down, back header and focus restoration for Usage and Telemetry. */
export function ReportPersonFrame<Person extends ReportPerson>({
	findPerson,
	children
}: ReportPersonFrameProps<Person>) {
	const choice = useUsagePerson();
	const person = findPerson(choice.accountId);

	usePersonFocus(person?.accountId ?? null);

	return (
		<>
			{person ? <UsagePersonHeader person={person} onBack={() => choice.select(null)} /> : null}
			<div className="usage-report">{children(person, choice.select, person?.accountId ?? EVERYONE)}</div>
		</>
	);
}
