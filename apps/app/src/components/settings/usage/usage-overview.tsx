'use client';

import type { UsageReport } from '@recoder/shared';
import { formatCompact, HoverList, LineChart } from '@recoder/ui';
import { useState } from 'react';

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
 * models) used them on the left, the daily chart on the right. The two are
 * linked: hovering a row brings its line forward, and the line under the
 * pointer in the chart lights its row.
 */
export function UsageOverview({ report, scope, onSelectPerson }: UsageOverviewProps) {
	const [highlight, setHighlight] = useState<string | null>(null);
	const { totals, person } = scope;
	const rows = railRows(report, scope);

	return (
		<section className="usage-overview" aria-label="Tokens">
			<div className="usage-rail">
				<div className="usage-total">
					<p className="usage-total-value">{formatCompact(totals.tokens)}</p>
					<p className="usage-total-meta">
						{formatSessions(totals.sessions)}
						<span className="meta-sep">
							<CostText cost={{ usd: totals.costUsd, complete: totals.costComplete }} />
						</span>
					</p>
				</div>
				<HoverList className="usage-rail-list" itemSelector="[data-rail-row]" aria-label={person ? 'Models' : 'People'}>
					{rows.map((row) => (
						<RailRow
							key={row.key}
							row={row}
							linked={highlight === row.key}
							onHighlight={setHighlight}
							onSelectPerson={person ? undefined : onSelectPerson}
						/>
					))}
				</HoverList>
			</div>
			<div className="usage-plot">
				<h2 className="usage-block-title">Daily processed tokens</h2>
				<LineChart
					series={scope.series}
					days={report.daily.map((day) => day.day)}
					height={CHART_HEIGHT}
					highlight={highlight}
					onHighlight={setHighlight}
					aria-label={person ? 'Daily processed tokens by model' : 'Daily processed tokens by person'}
				/>
			</div>
		</section>
	);
}
