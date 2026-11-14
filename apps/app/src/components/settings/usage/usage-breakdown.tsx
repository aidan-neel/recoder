'use client';

import type { UsageReport } from '@recoder/shared';
import { Button, SegmentedControl } from '@recoder/ui';
import { useState } from 'react';

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
	const [picked, setPicked] = useState<BreakdownMode>('model');
	const [expanded, setExpanded] = useState(false);
	const modes = breakdownModes(scope);
	const mode = modes.includes(picked) ? picked : 'model';
	const rows = breakdownRows(report, scope, mode);
	const folds = rows.length > BREAKDOWN_PAGE;

	return (
		<UsageBlock
			title="Breakdown"
			note={unpricedNote(scope)}
			action={
				<SegmentedControl
					value={mode}
					onValueChange={(value) => {
						setPicked(modes.find((option) => option === value) ?? 'model');
						setExpanded(false);
					}}
					options={modes.map((option) => ({ value: option, label: MODE_LABELS[option] }))}
					aria-label="Group by"
				/>
			}
		>
			<UsageRows
				rows={expanded ? rows : rows.slice(0, BREAKDOWN_PAGE)}
				nameHeading={MODE_LABELS[mode]}
				aria-label={`Tokens by ${MODE_LABELS[mode].toLowerCase()}`}
				onSelectPerson={mode === 'person' ? onSelectPerson : undefined}
			/>
			{folds ? (
				<Button variant="ghost" className="usage-more" onClick={() => setExpanded((open) => !open)}>
					{expanded ? 'Show fewer' : `Show all ${rows.length} ${MODE_PLURALS[mode]}`}
				</Button>
			) : null}
		</UsageBlock>
	);
}
