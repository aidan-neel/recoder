import { ChartTip, formatCompact, formatShare, Tooltip } from '@recoder/ui';
import { ChevronRight } from 'lucide-react';

import { formatWhole } from '@/lib/usage/usage-model';
import { rowTip, type UsageRow } from '@/lib/usage/usage-rows';

import { CostText } from './usage-cost';
import { RowLead } from './usage-row-lead';

interface UsageRowViewProps {
	row: UsageRow;
	/** The biggest share in the table: its row's line under the name runs the full width. */
	widest: number;
	/** Whether the table has a Sessions column: days have no sessions of their own. */
	hasSessions: boolean;
	/** Whether the table has a Calls column: only the kinds have one. */
	hasCalls: boolean;
	/** Whether the table has a Cost column; a row with no cost of its own leaves it empty. */
	hasCost: boolean;
	/** Opens a person's view. Without it a person's row is plain. */
	onSelectPerson?: (accountId: string) => void;
}

/**
 * One row: what it is over a line as long as its share, split in the chart's
 * colors, then its sessions, calls, share, cost and tokens. Resting on the row (or
 * focusing it) opens a tip with its split and its tokens by kind. A person's
 * row opens their view.
 */
export function UsageRowView({ row, widest, hasSessions, hasCalls, hasCost, onSelectPerson }: UsageRowViewProps) {
	const personId = row.personId && onSelectPerson ? row.personId : null;
	const tip = rowTip(row);

	return (
		<Tooltip
			side="top"
			align="end"
			content={<ChartTip heading={tip.heading} value={tip.value} rows={tip.rows} details={tip.details} />}
		>
			<div role="row" data-row className="usage-row" tabIndex={personId ? undefined : 0}>
				<div role="cell" className="usage-cell usage-cell-name">
					<RowName row={row} widest={widest} personId={personId} onSelectPerson={onSelectPerson} />
				</div>
				{hasSessions ? (
					<div role="cell" className="usage-cell usage-cell-figure usage-cell-quiet">
						{row.sessions === null ? null : formatWhole(row.sessions)}
					</div>
				) : null}
				{hasCalls ? (
					<div role="cell" className="usage-cell usage-cell-figure usage-cell-quiet">
						{row.calls === null ? null : formatCompact(row.calls)}
					</div>
				) : null}
				<div role="cell" className="usage-cell usage-cell-figure usage-cell-quiet">
					{formatShare(row.share)}
				</div>
				{hasCost ? (
					<div role="cell" className="usage-cell usage-cell-figure">
						{row.cost ? <CostText cost={row.cost} /> : null}
					</div>
				) : null}
				<div role="cell" className="usage-cell usage-cell-figure">
					{formatCompact(row.tokens)}
				</div>
				{onSelectPerson ? (
					<div role="cell" className="usage-cell usage-cell-go">
						{personId ? <ChevronRight aria-hidden /> : null}
					</div>
				) : null}
			</div>
		</Tooltip>
	);
}

interface RowNameProps {
	row: UsageRow;
	widest: number;
	personId: string | null;
	onSelectPerson?: (accountId: string) => void;
}

/** The row's mark and name over its share line; a button that opens the person on a person's row. */
function RowName({ row, widest, personId, onSelectPerson }: RowNameProps) {
	const name = (
		<>
			<span className="usage-row-title">
				<RowLead lead={row.lead} />
				<span className="usage-row-name">{row.name}</span>
			</span>
			<ShareLine row={row} widest={widest} />
		</>
	);

	if (personId && onSelectPerson) {
		return (
			<button type="button" className="usage-select" data-person-id={personId} onClick={() => onSelectPerson(personId)}>
				{name}
			</button>
		);
	}

	return <span className="usage-plain">{name}</span>;
}

/** The row's share as a line under its name, as long as its share of the widest row and split by the chart's lines. */
function ShareLine({ row, widest }: { row: UsageRow; widest: number }) {
	return (
		<span className="usage-share" style={{ width: `${widest > 0 ? (row.share / widest) * 100 : 0}%` }} aria-hidden>
			{row.parts.map((part) => (
				<span key={part.id} style={{ flexGrow: part.value, background: part.color }} />
			))}
		</span>
	);
}
