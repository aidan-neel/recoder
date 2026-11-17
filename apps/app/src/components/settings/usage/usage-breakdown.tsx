'use client';

import type { UsageReport } from '@recoder/shared';
import { Button, SegmentedControl } from '@recoder/ui';
import { useState, type ReactNode } from 'react';

import { unpricedNote, type UsageScope } from '@/lib/usage/usage-model';
import { BREAKDOWN_PAGE, breakdownModes, breakdownRows, type BreakdownMode } from '@/lib/usage/usage-rows';

import { UsageBlock } from './usage-block';
import { UsageRows } from './usage-rows';

const MODE_LABELS: Record<BreakdownMode, string> = { model: 'Model', day: 'Day', person: 'Person' };

/** What Show all names: "Show all 30 days". */
const MODE_PLURALS: Record<BreakdownMode, string> = { model: 'models', day: 'days', person: 'people' };

interface UsageBreakdownProps {
	report: UsageReport;
	scope: UsageScope;
	onSelectPerson: (accountId: string) => void;
}

/**
 * The scope's tokens by model, day or person, each name over a line of its
 * share in the chart's colors. The first ten rows show; Show all opens the rest.
 */
export function UsageBreakdown({ report, scope, onSelectPerson }: UsageBreakdownProps) {
	return (
		<ReportBreakdown
			modes={breakdownModes(scope)}
			labels={MODE_LABELS}
			plurals={MODE_PLURALS}
			note={unpricedNote(scope)}
			rowsFor={(mode) => breakdownRows(report, scope, mode)}
			renderTable={(visibleRows, mode) => (
				<UsageRows
					rows={visibleRows}
					nameHeading={MODE_LABELS[mode]}
					aria-label={`Tokens by ${MODE_LABELS[mode].toLowerCase()}`}
					onSelectPerson={mode === 'person' ? onSelectPerson : undefined}
				/>
			)}
		/>
	);
}

interface ReportBreakdownProps<Mode extends string, Row> {
	modes: readonly Mode[];
	labels: Record<Mode, string>;
	plurals: Record<Mode, string>;
	note?: string | null;
	rowsFor: (mode: Mode) => Row[];
	renderTable: (visibleRows: Row[], mode: Mode) => ReactNode;
}

/** Shared Breakdown block with Group-by segmented control and Show-all toggle. */
export function ReportBreakdown<Mode extends string, Row>({
	modes,
	labels,
	plurals,
	note,
	rowsFor,
	renderTable
}: ReportBreakdownProps<Mode, Row>) {
	const [picked, setPicked] = useState<Mode>(modes[0]);
	const [expanded, setExpanded] = useState(false);
	const mode = modes.includes(picked) ? picked : modes[0];
	const rows = rowsFor(mode);
	const folds = rows.length > BREAKDOWN_PAGE;

	return (
		<UsageBlock
			title="Breakdown"
			note={note}
			action={
				<SegmentedControl
					value={mode}
					onValueChange={(value) => {
						setPicked(modes.find((option) => option === value) ?? modes[0]);
						setExpanded(false);
					}}
					options={modes.map((option) => ({ value: option, label: labels[option] }))}
					aria-label="Group by"
				/>
			}
		>
			{renderTable(expanded ? rows : rows.slice(0, BREAKDOWN_PAGE), mode)}
			{folds ? (
				<Button variant="ghost" className="usage-more" onClick={() => setExpanded((open) => !open)}>
					{expanded ? 'Show fewer' : `Show all ${rows.length} ${plurals[mode]}`}
				</Button>
			) : null}
		</UsageBlock>
	);
}
