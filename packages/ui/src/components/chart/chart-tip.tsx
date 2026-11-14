import { cn } from '../../lib/cn';

/** One line of a tip: a name, its value, and the swatch of the series when it has one. */
export interface ChartTipRow {
	id: string;
	label: string;
	value: string;
	/** Any CSS color; a token such as `var(--chart-1)` follows the theme. */
	color?: string;
	/** A quieter figure after the value, such as the row's share of the heading's total. */
	detail?: string;
	/** The line the pointer or the keys are on: drawn at full strength while the rest step back. */
	active?: boolean;
}

interface ChartTipProps {
	/** What the tip is about: a day, a model, a kind of token. */
	heading: string;
	/** The headline number, at the end of the heading line. */
	value?: string;
	rows?: readonly ChartTipRow[];
	/** A second group under a hairline, for figures of another kind than the rows. */
	details?: readonly ChartTipRow[];
	className?: string;
}

/**
 * The body of a chart's hover tip: a heading with its number, then a line for
 * each part, its value and share in columns that line up. The line chart lays
 * it in its own layer that follows the pointer; a table row or a stacked
 * bar's segment puts it in a `Tooltip`.
 */
export function ChartTip({ heading, value, rows = [], details = [], className }: ChartTipProps) {
	const hasActive = rows.some((row) => row.active);

	return (
		<div data-ui="chart-tip" data-focused={hasActive || undefined} className={cn(className)}>
			<div data-part="heading">
				<span data-part="name">{heading}</span>
				{value ? <span data-part="total">{value}</span> : null}
			</div>
			{rows.map((row) => (
				<TipLine key={row.id} row={row} />
			))}
			{details.length > 0 ? <span data-part="rule" aria-hidden /> : null}
			{details.map((row) => (
				<TipLine key={row.id} row={row} />
			))}
		</div>
	);
}

function TipLine({ row }: { row: ChartTipRow }) {
	return (
		<div data-part="row" data-active={row.active || undefined}>
			<span data-part="swatch" style={row.color ? { background: row.color } : undefined} aria-hidden />
			<span data-part="label">{row.label}</span>
			<span data-part="value">{row.value}</span>
			<span data-part="detail">{row.detail}</span>
		</div>
	);
}
