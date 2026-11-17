import { HoverList } from '@recoder/ui';
import { Fragment, type CSSProperties, type ReactNode } from 'react';

import type { UsageRow } from '@/lib/usage/usage-rows';

import { UsageRowView } from './usage-row';

/** A column the table can show; each has its width in `usage.css` as `--usage-col-<name>`. */
type UsageColumn = 'sessions' | 'calls' | 'share' | 'cost' | 'tokens';

/** The columns after the name, in the order the head and the rows render their cells. */
const HEADINGS: Record<UsageColumn, string> = {
	sessions: 'Sessions',
	calls: 'Calls',
	share: 'Share',
	cost: 'Cost',
	tokens: 'Tokens'
};

/** The Breakdown's table: a header, then rows split by hairlines over one hover highlight. */
export function UsageRows(props: ReportTableFrameProps<UsageRow>) {
	const { rows, onSelectPerson } = props;
	const hasSessions = rows.some((row) => row.sessions !== null);
	const hasCalls = rows.some((row) => row.calls !== null);
	const hasCost = rows.some((row) => row.cost);

	const shown: Record<UsageColumn, boolean> = {
		sessions: hasSessions,
		calls: hasCalls,
		share: true,
		cost: hasCost,
		tokens: true
	};

	return (
		<ReportTable
			{...props}
			headings={HEADINGS}
			shown={shown}
			renderRow={(row, widest) => (
				<UsageRowView
					row={row}
					widest={widest}
					hasSessions={hasSessions}
					hasCalls={hasCalls}
					hasCost={hasCost}
					onSelectPerson={onSelectPerson}
				/>
			)}
		/>
	);
}

/** What the table needs of a row: a key and the share its line is sized by. */
interface ReportRow {
	key: string;
	share: number;
}

/** What a table has in common across its views: its rows, the name column's heading and the open column. */
export interface ReportTableFrameProps<Row extends ReportRow> {
	rows: Row[];
	/** The first column's name, over the rows. */
	nameHeading: string;
	'aria-label': string;
	/** Opens a person's view from a person's row. */
	onSelectPerson?: (accountId: string) => void;
}

interface ReportTableProps<Row extends ReportRow> extends ReportTableFrameProps<Row> {
	/** Header text for each column after the name, in render order. */
	headings: Readonly<Record<string, string>>;
	/** Which of the `headings` columns to render. */
	shown: Readonly<Record<string, boolean>>;
	/** Renders one row; `widest` is the biggest share, which a row's line under its name is sized against. */
	renderRow: (row: Row, widest: number) => ReactNode;
}

/** Shared table container with CSS-variable column tracks and header cells. */
export function ReportTable<Row extends ReportRow>({
	rows,
	nameHeading,
	'aria-label': label,
	onSelectPerson,
	headings,
	shown,
	renderRow
}: ReportTableProps<Row>) {
	const shownColumns = Object.keys(headings).filter((column) => shown[column]);
	const columns = ['name', ...shownColumns, ...(onSelectPerson === undefined ? [] : ['go'])];
	const widest = Math.max(0, ...rows.map((row) => row.share));

	return (
		<HoverList
			role="table"
			aria-label={label}
			itemSelector="[data-row]"
			className="usage-rows"
			style={columnsStyle(columns)}
		>
			<div role="row" className="usage-head">
				{columns.map((column) => (
					<ReportColumnHeader key={column} column={column} nameHeading={nameHeading} headings={headings} />
				))}
			</div>
			{rows.map((row) => (
				<Fragment key={row.key}>{renderRow(row, widest)}</Fragment>
			))}
		</HoverList>
	);
}

interface ReportColumnHeaderProps {
	column: string;
	nameHeading: string;
	headings: Readonly<Record<string, string>>;
}

function ReportColumnHeader({ column, nameHeading, headings }: ReportColumnHeaderProps) {
	if (column === 'go') return <span role="columnheader" aria-label="Open" />;

	return <span role="columnheader">{column === 'name' ? nameHeading : headings[column]}</span>;
}

/**
 * One grid track per rendered column, from the widths in `usage.css`. The cast
 * is safe: React's style type has no custom properties, and this sets only one.
 */
function columnsStyle(columns: readonly string[]): CSSProperties {
	return { '--usage-columns': columns.map((column) => `var(--usage-col-${column})`).join(' ') } as CSSProperties;
}
