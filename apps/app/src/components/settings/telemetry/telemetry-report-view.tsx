'use client';

import type { TelemetryReport } from '@recoder/shared';

import { findActiveTelemetryPerson, telemetryScope } from '@/lib/telemetry/telemetry-model';

import { ReportPersonFrame } from '../usage/usage-report-view';
import { TelemetryBreakdown } from './telemetry-breakdown';
import { TelemetryOverview } from './telemetry-overview';
import { TelemetryFindings, TelemetryPullRequests } from './telemetry-totals';

/**
 * Settings → Telemetry once the report has loaded: overview, pull request figures,
 * finding figures, severity distribution and breakdown, scoped to everyone or `?person=`.
 */
export function TelemetryReportView({ report }: { report: TelemetryReport }) {
	return (
		<ReportPersonFrame findPerson={(accountId) => findActiveTelemetryPerson(report, accountId)}>
			{(person, select, viewKey) => {
				const scope = telemetryScope(report, person);

				return (
					<>
						<TelemetryOverview key={viewKey} report={report} scope={scope} onSelectPerson={select} />
						<TelemetryPullRequests scope={scope} />
						<TelemetryFindings scope={scope} />
						<TelemetryBreakdown report={report} scope={scope} onSelectPerson={select} />
					</>
				);
			}}
		</ReportPersonFrame>
	);
}
