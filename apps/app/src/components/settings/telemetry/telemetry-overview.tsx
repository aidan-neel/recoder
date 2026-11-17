'use client';

import type { TelemetryReport } from '@recoder/shared';

import { formatReviews, type TelemetryScope } from '@/lib/telemetry/telemetry-model';
import { telemetryRailRows, type TelemetryRow } from '@/lib/telemetry/telemetry-rows';
import { formatWhole } from '@/lib/usage/report-shared';

import { ReportOverview } from '../usage/usage-overview';
import { ReportRailRow } from '../usage/usage-rail-row';

interface TelemetryOverviewProps {
	report: TelemetryReport;
	scope: TelemetryScope;
	onSelectPerson: (accountId: string) => void;
}

/**
 * Top of Settings → Telemetry: reviewed pull requests and who (or, for one person, which
 * repositories) reviewed them on the left, linked to the daily chart on the right.
 */
export function TelemetryOverview({ report, scope, onSelectPerson }: TelemetryOverviewProps) {
	const { totals, person } = scope;
	const rows = telemetryRailRows(report, scope);

	return (
		<ReportOverview
			ariaLabel="Pull requests reviewed"
			totalValue={formatWhole(totals.prsReviewed)}
			totalMeta={
				<>
					{formatReviews(totals.reviews)}
					<span className="meta-sep">{formatWhole(totals.prsMerged)} merged</span>
				</>
			}
			railLabel={person ? 'Repositories' : 'People'}
			plotTitle="Daily pull requests reviewed"
			plotLabel={person ? 'Daily pull requests reviewed by repository' : 'Daily pull requests reviewed by person'}
			series={scope.series}
			days={report.daily.map((day) => day.day)}
			formatValue={formatWhole}
			emptyLabel="No reviews"
			renderRows={(highlight, setHighlight) =>
				rows.map((row) => (
					<TelemetryRailRow
						key={row.key}
						row={row}
						linked={highlight === row.key}
						onHighlight={setHighlight}
						onSelectPerson={person ? undefined : onSelectPerson}
					/>
				))
			}
		/>
	);
}

interface TelemetryRailRowProps {
	row: TelemetryRow;
	linked: boolean;
	onHighlight: (id: string | null) => void;
	onSelectPerson?: (accountId: string) => void;
}

function TelemetryRailRow({ row, linked, onHighlight, onSelectPerson }: TelemetryRailRowProps) {
	return (
		<ReportRailRow
			rowKey={row.key}
			color={row.color}
			lead={row.lead}
			name={row.name}
			value={formatWhole(row.prsReviewed)}
			share={row.share}
			personId={row.personId}
			linked={linked}
			onHighlight={onHighlight}
			onSelectPerson={onSelectPerson}
		>
			<span className="meta-sep">{formatWhole(row.findingsAccepted)} accepted</span>
			<span className="meta-sep">{formatWhole(row.prsMerged)} merged</span>
		</ReportRailRow>
	);
}
