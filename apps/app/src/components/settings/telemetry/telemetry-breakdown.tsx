'use client';

import type { TelemetryReport } from '@recoder/shared';

import type { TelemetryScope } from '@/lib/telemetry/telemetry-model';
import {
	telemetryBreakdownModes,
	telemetryBreakdownRows,
	type TelemetryBreakdownMode
} from '@/lib/telemetry/telemetry-rows';

import { ReportBreakdown } from '../usage/usage-breakdown';
import { TelemetryRows } from './telemetry-rows';

const MODE_LABELS: Record<TelemetryBreakdownMode, string> = {
	person: 'Person',
	repo: 'Repository',
	day: 'Day'
};

const MODE_PLURALS: Record<TelemetryBreakdownMode, string> = {
	person: 'people',
	repo: 'repositories',
	day: 'days'
};

interface TelemetryBreakdownProps {
	report: TelemetryReport;
	scope: TelemetryScope;
	onSelectPerson: (accountId: string) => void;
}

/** Breakdown of pull requests, merges, findings and average tokens by Person, Repository or Day. */
export function TelemetryBreakdown({ report, scope, onSelectPerson }: TelemetryBreakdownProps) {
	return (
		<ReportBreakdown
			modes={telemetryBreakdownModes(scope)}
			labels={MODE_LABELS}
			plurals={MODE_PLURALS}
			rowsFor={(mode) => telemetryBreakdownRows(report, scope, mode)}
			renderTable={(visibleRows, mode) => (
				<TelemetryRows
					rows={visibleRows}
					nameHeading={MODE_LABELS[mode]}
					aria-label={`Pull requests by ${MODE_LABELS[mode].toLowerCase()}`}
					onSelectPerson={mode === 'person' ? onSelectPerson : undefined}
				/>
			)}
		/>
	);
}
