import { formatCompact, formatShare } from '@recoder/ui';
import type { ReactNode } from 'react';

import type { RowLead as RowLeadValue } from '@/lib/usage/report-shared';
import { formatSessions } from '@/lib/usage/usage-model';
import type { UsageRow } from '@/lib/usage/usage-rows';

import { CostText } from './usage-cost';
import { RowLead } from './usage-row-lead';

interface RailRowProps {
	row: UsageRow;
	/** True while the row's line is the one hovered in the chart. */
	linked: boolean;
	/** Brings the row's line forward in the chart, or none with `null`. */
	onHighlight: (id: string | null) => void;
	/** Opens a person's view; without it the row is plain. */
	onSelectPerson?: (accountId: string) => void;
}

/**
 * One line of the chart, named beside it: its color, mark, name and tokens,
 * with its share, sessions and cost under the name. Hovering or
 * focusing it brings its line forward; a person's row opens their view.
 */
export function RailRow({ row, linked, onHighlight, onSelectPerson }: RailRowProps) {
	return (
		<ReportRailRow
			rowKey={row.key}
			color={row.color}
			lead={row.lead}
			name={row.name}
			value={formatCompact(row.tokens)}
			share={row.share}
			personId={row.personId}
			linked={linked}
			onHighlight={onHighlight}
			onSelectPerson={onSelectPerson}
		>
			{row.sessions === null ? null : <span className="meta-sep">{formatSessions(row.sessions)}</span>}
			{row.cost ? (
				<span className="meta-sep">
					<CostText cost={row.cost} />
				</span>
			) : null}
		</ReportRailRow>
	);
}

interface ReportRailRowProps {
	rowKey: string;
	color: string | null;
	lead: RowLeadValue;
	name: string;
	value: string;
	share: number;
	personId: string | null;
	linked: boolean;
	onHighlight: (id: string | null) => void;
	onSelectPerson?: (accountId: string) => void;
	children?: ReactNode;
}

/** Shared chart-rail row used by Usage and Telemetry overviews. */
export function ReportRailRow({
	rowKey,
	color,
	lead,
	name,
	value,
	share,
	personId,
	linked,
	onHighlight,
	onSelectPerson,
	children
}: ReportRailRowProps) {
	const openId = personId && onSelectPerson ? personId : null;

	return (
		<RailItem
			personId={openId}
			linked={linked}
			onOpen={onSelectPerson}
			onEnter={() => onHighlight(rowKey)}
			onLeave={() => onHighlight(null)}
		>
			<span className="usage-rail-dot" style={{ background: color ?? undefined }} aria-hidden />
			<span className="usage-rail-mark">
				<RowLead lead={lead} />
			</span>
			<span className="usage-rail-name">{name}</span>
			<span className="usage-rail-tokens">{value}</span>
			<span className="usage-rail-meta">
				{formatShare(share)}
				{children}
			</span>
		</RailItem>
	);
}

interface RailItemProps {
	/** Set when the row opens a person's view. */
	personId: string | null;
	linked: boolean;
	onOpen?: (accountId: string) => void;
	onEnter: () => void;
	onLeave: () => void;
	children: ReactNode;
}

/** The row's element: a button for a person who can be opened, a plain item otherwise. */
function RailItem({ personId, linked, onOpen, onEnter, onLeave, children }: RailItemProps) {
	const shared = {
		'data-rail-row': true,
		'data-linked': linked || undefined,
		className: 'usage-rail-row',
		onPointerEnter: onEnter,
		onPointerLeave: onLeave,
		onFocus: onEnter,
		onBlur: onLeave
	};

	if (personId && onOpen) {
		return (
			<button type="button" data-person-id={personId} onClick={() => onOpen(personId)} {...shared}>
				{children}
			</button>
		);
	}

	return <div {...shared}>{children}</div>;
}
