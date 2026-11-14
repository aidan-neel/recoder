import { HoverList } from '@recoder/ui';

import type { UsageRow } from '@/lib/usage/usage-rows';

import { UsageRowView } from './usage-row';

interface UsageRowsProps {
	rows: UsageRow[];
	/** The first column's name, over the rows. */
	nameHeading: string;
	'aria-label': string;
	/** Opens a person's view from a person's row. */
	onSelectPerson?: (accountId: string) => void;
}

/** The Breakdown's table: a header, then rows split by hairlines over one hover highlight. */
export function UsageRows({ rows, nameHeading, 'aria-label': label, onSelectPerson }: UsageRowsProps) {
	const hasSessions = rows.some((row) => row.sessions !== null);
	const hasCalls = rows.some((row) => row.calls !== null);
	const hasCost = rows.some((row) => row.cost);
	const widest = Math.max(...rows.map((row) => row.share));

	return (
		<HoverList
			role="table"
			aria-label={label}
			itemSelector="[data-row]"
			className="usage-rows"
			data-sessions={hasSessions || undefined}
			data-calls={hasCalls || undefined}
			data-cost={hasCost || undefined}
			data-go={onSelectPerson ? true : undefined}
		>
			<div role="row" className="usage-head">
				<span role="columnheader">{nameHeading}</span>
				{hasSessions ? <span role="columnheader">Sessions</span> : null}
				{hasCalls ? <span role="columnheader">Calls</span> : null}
				<span role="columnheader">Share</span>
				{hasCost ? <span role="columnheader">Cost</span> : null}
				<span role="columnheader">Tokens</span>
				{onSelectPerson ? <span role="columnheader" aria-label="Open" /> : null}
			</div>
			{rows.map((row) => (
				<UsageRowView
					key={row.key}
					row={row}
					widest={widest}
					hasSessions={hasSessions}
					hasCalls={hasCalls}
					hasCost={hasCost}
					onSelectPerson={onSelectPerson}
				/>
			))}
		</HoverList>
	);
}
