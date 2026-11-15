'use client';

import type { UsageReport } from '@recoder/shared';
import { formatCompact, HoverList, LineChart, type ChartSeries } from '@recoder/ui';
import { useState, type ReactNode } from 'react';

import { formatSessions, type UsageScope } from '@/lib/usage/usage-model';
import { railRows } from '@/lib/usage/usage-rows';

import { CostText } from './usage-cost';
import { RailRow } from './usage-rail-row';

/** The chart's height in px: about the total and four rows beside it. */
const CHART_HEIGHT = 268;

interface UsageOverviewProps {
	report: UsageReport;
	scope: UsageScope;
	onSelectPerson: (accountId: string) => void;
}

/**
 * The top of the page: the window's tokens and who (or, for one person, which
 * models) used them on the left, the daily chart on the right.
 */
export function UsageOverview({ report, scope, onSelectPerson }: UsageOverviewProps) {
	const { totals, person } = scope;
	const rows = railRows(report, scope);

	return (
		<ReportOverview
			ariaLabel="Tokens"
			totalValue={formatCompact(totals.tokens)}
			totalMeta={
				<>
					{formatSessions(totals.sessions)}
					<span className="meta-sep">
						<CostText cost={{ usd: totals.costUsd, complete: totals.costComplete }} />
					</span>
				</>
			}
			railLabel={person ? 'Models' : 'People'}
			plotTitle="Daily processed tokens"
			plotLabel={person ? 'Daily processed tokens by model' : 'Daily processed tokens by person'}
			series={scope.series}
			days={report.daily.map((day) => day.day)}
			renderRows={(highlight, setHighlight) =>
				rows.map((row) => (
					<RailRow
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

interface ReportOverviewProps {
	ariaLabel: string;
	totalValue: string;
	totalMeta: ReactNode;
	railLabel: string;
	plotTitle: string;
	plotLabel: string;
	series: ChartSeries[];
	days: string[];
	formatValue?: (value: number) => string;
	emptyLabel?: string;
	renderRows: (highlight: string | null, setHighlight: (id: string | null) => void) => ReactNode;
}

/** Shared two-column rail + daily chart overview used by Usage and Telemetry. */
export function ReportOverview({
	ariaLabel,
	totalValue,
	totalMeta,
	railLabel,
	plotTitle,
	plotLabel,
	series,
	days,
	formatValue,
	emptyLabel,
	renderRows
}: ReportOverviewProps) {
	const [highlight, setHighlight] = useState<string | null>(null);

	return (
		<section className="usage-overview" aria-label={ariaLabel}>
			<div className="usage-rail">
				<div className="usage-total">
					<p className="usage-total-value">{totalValue}</p>
					<p className="usage-total-meta">{totalMeta}</p>
				</div>
				<HoverList className="usage-rail-list" itemSelector="[data-rail-row]" aria-label={railLabel}>
					{renderRows(highlight, setHighlight)}
				</HoverList>
			</div>
			<div className="usage-plot">
				<h2 className="usage-block-title">{plotTitle}</h2>
				<LineChart
					series={series}
					days={days}
					formatValue={formatValue}
					emptyLabel={emptyLabel}
					height={CHART_HEIGHT}
					highlight={highlight}
					onHighlight={setHighlight}
					aria-label={plotLabel}
				/>
			</div>
		</section>
	);
}
