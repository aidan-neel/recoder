import { formatCompact, formatShare } from '@recoder/ui';
import type { ReactNode } from 'react';

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
	const personId = row.personId && onSelectPerson ? row.personId : null;

	return (
		<RailItem
			personId={personId}
			linked={linked}
			onOpen={onSelectPerson}
			onEnter={() => onHighlight(row.key)}
			onLeave={() => onHighlight(null)}
		>
			<span className="usage-rail-dot" style={{ background: row.color ?? undefined }} aria-hidden />
			<span className="usage-rail-mark">
				<RowLead lead={row.lead} />
			</span>
			<span className="usage-rail-name">{row.name}</span>
			<span className="usage-rail-tokens">{formatCompact(row.tokens)}</span>
			<span className="usage-rail-meta">
				{formatShare(row.share)}
				{row.sessions === null ? null : <span className="meta-sep">{formatSessions(row.sessions)}</span>}
				{row.cost ? (
					<span className="meta-sep">
						<CostText cost={row.cost} />
					</span>
				) : null}
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
