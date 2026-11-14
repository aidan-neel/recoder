'use client';

import { useId, useMemo, useRef, useState, type FocusEvent, type KeyboardEvent, type PointerEvent } from 'react';

import { cn } from '../../lib/cn';
import { ChartTip, type ChartTipRow } from './chart-tip';
import {
	dayTip,
	dayValues,
	formatCompact,
	formatShare,
	nearestPoint,
	nearestSeries,
	niceTicks,
	pointXs,
	smoothArea,
	smoothLine,
	tickIndexes,
	type DayTip
} from './chart-math';
import { useWidth } from './use-width';

/** One line of the chart: a value for each day, in the days' order. */
export interface ChartSeries {
	id: string;
	label: string;
	/** Any CSS color; a token such as `var(--chart-1)` follows the theme. */
	color: string;
	values: readonly number[];
}

interface LineChartProps {
	/** Drawn in this order, so the first sits behind the rest: put the biggest first. */
	series: readonly ChartSeries[];
	/** One `YYYY-MM-DD` date for each value, oldest first. */
	days: readonly string[];
	/** How the tooltip writes a value. Axis labels are always compact. */
	formatValue?: (value: number) => string;
	height?: number;
	/** The series brought forward, as when its row beside the chart is hovered; the others step back. */
	highlight?: string | null;
	/**
	 * Called with the line the pointer rests on (or that Up and Down pick), and
	 * with null as it leaves, so a list beside the chart can light its row.
	 */
	onHighlight?: (id: string | null) => void;
	'aria-label': string;
	className?: string;
}

const MARGIN = { top: 12, right: 4, bottom: 28, left: 36 } as const;
const NARROW_WIDTH = 420;
const TIP_GAP = 16;
const TIP_FLIP_SIDE = 0.6;

/** How near, in px, the pointer must come to a line's mark for that line to count as hovered. */
const LINE_REACH = 18;

/** What a day with nothing in it says where its total would be. */
const NO_USAGE = 'No usage';

const axisDate = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });

const tipDate = new Intl.DateTimeFormat('en-US', {
	weekday: 'short',
	month: 'short',
	day: 'numeric',
	timeZone: 'UTC'
});

function formatAxisDay(day: string): string {
	return axisDate.format(new Date(`${day}T00:00:00Z`));
}

function formatTipDay(day: string): string {
	return tipDate.format(new Date(`${day}T00:00:00Z`));
}

/** The lines the tooltip lists for a day: each series with its value and share of the day, then what the rest add up to. */
function tipRows(tip: DayTip, highlight: string | null, formatValue: (value: number) => string): ChartTipRow[] {
	const rows = tip.rows.map((row) => ({
		id: row.id,
		label: row.label,
		color: row.color,
		value: formatValue(row.value),
		detail: formatShare(row.value / tip.total),
		active: row.id === highlight
	}));

	if (!tip.rest) return rows;

	return [
		...rows,
		{
			id: 'rest',
			label: `${tip.rest.count} more`,
			value: formatValue(tip.rest.value),
			detail: formatShare(tip.rest.value / tip.total)
		}
	];
}

/** The day a key moves to from `from`, or null for a key that does not move between days. */
function dayAfterKey(key: string, from: number, last: number): number | null {
	switch (key) {
		case 'ArrowLeft':
			return Math.max(0, from - 1);
		case 'ArrowRight':
			return Math.min(last, from + 1);
		case 'Home':
			return 0;
		case 'End':
			return last;
		default:
			return null;
	}
}

/** The line Up or Down moves to among the day's lines (biggest first), or undefined for another key. */
function lineAfterKey(key: string, order: readonly string[], current: string | null): string | null | undefined {
	if (key !== 'ArrowUp' && key !== 'ArrowDown') return undefined;
	if (order.length === 0) return null;

	const at = current === null ? -1 : order.indexOf(current);

	if (key === 'ArrowDown') return order[Math.min(order.length - 1, at + 1)];

	return at <= 0 ? order[0] : order[at - 1];
}

/** Where the axis's date labels go: under their day, the outer two kept inside the plot. */
function labelAnchor(position: number, count: number): 'start' | 'middle' | 'end' {
	if (position === 0) return 'start';
	if (position === count - 1) return 'end';

	return 'middle';
}

/**
 * Each series as a smooth line over a soft fill, on a shared 0-based axis.
 * Hovering (or, with the chart focused, Left, Right, Home and End) drops a
 * guide on the day, marks each line there and opens a tooltip with the date,
 * the day's total and each series' part; the line nearest the pointer (or
 * the one Up and Down pick) comes forward and is reported through
 * `onHighlight`. It is drawn at its measured width, so text is never scaled.
 */
export function LineChart({
	series,
	days,
	formatValue = formatCompact,
	height = 240,
	highlight = null,
	onHighlight,
	'aria-label': label,
	className
}: LineChartProps) {
	const [wrapperRef, width] = useWidth<HTMLDivElement>();
	const [active, setActive] = useState<number | null>(null);
	const reported = useRef<string | null>(null);
	const fillId = useId();

	const plot = {
		left: MARGIN.left,
		right: Math.max(MARGIN.left + 1, width - MARGIN.right),
		top: MARGIN.top,
		bottom: height - MARGIN.bottom
	};

	const peak = useMemo(() => Math.max(0, ...series.flatMap((line) => line.values)), [series]);
	const ticks = useMemo(() => niceTicks(peak), [peak]);
	const top = ticks[ticks.length - 1];
	const xs = pointXs(days.length, plot.left, plot.right);
	const labelIndexes = tickIndexes(days.length, width < NARROW_WIDTH ? 3 : 6);
	const last = days.length - 1;

	const yAt = (value: number): number => plot.bottom - (value / top) * (plot.bottom - plot.top);
	const pointsOf = (line: ChartSeries) => xs.map((x, index) => ({ x, y: yAt(line.values[index] ?? 0) }));

	/** Tells the host which line is hovered, once per change. */
	function report(id: string | null): void {
		if (reported.current === id) return;

		reported.current = id;
		onHighlight?.(id);
	}

	function follow(event: PointerEvent<SVGSVGElement>): void {
		const box = event.currentTarget.getBoundingClientRect();
		const day = nearestPoint(event.clientX - box.left, plot.left, plot.right, days.length);

		setActive(day);

		if (day === null) return report(null);

		const marks = dayValues(series, day).map((line) => ({ id: line.id, y: yAt(line.value) }));

		report(nearestSeries(marks, event.clientY - box.top, LINE_REACH));
	}

	function leave(): void {
		setActive(null);
		report(null);
	}

	function focusIn(event: FocusEvent<HTMLDivElement>): void {
		if (event.currentTarget.matches(':focus-visible')) setActive((current) => current ?? last);
	}

	function pressKey(event: KeyboardEvent<HTMLDivElement>): void {
		if (event.key === 'Escape') return leave();

		const day = active ?? last;

		const line = lineAfterKey(
			event.key,
			dayValues(series, day).map((value) => value.id),
			highlight
		);

		if (line !== undefined) {
			event.preventDefault();
			setActive(day);

			return report(line);
		}

		const next = dayAfterKey(event.key, day, last);

		if (next === null) return;

		event.preventDefault();
		setActive(next);
	}

	const tip = active === null ? null : dayTip(series, active);
	const activeX = active === null ? 0 : xs[active];
	const flipped = activeX > width * TIP_FLIP_SIDE;

	return (
		<div
			ref={wrapperRef}
			data-ui="line-chart"
			data-highlight={highlight ? true : undefined}
			role="group"
			aria-roledescription="chart"
			aria-label={label}
			tabIndex={days.length > 0 ? 0 : undefined}
			className={cn(className)}
			style={{ height }}
			onPointerLeave={leave}
			onFocus={focusIn}
			onBlur={leave}
			onKeyDown={pressKey}
		>
			{width > 0 ? (
				<svg
					width={width}
					height={height}
					aria-hidden
					onPointerMove={follow}
					onPointerDown={follow}
					style={{ touchAction: 'pan-y' }}
				>
					<defs>
						{series.map((line, index) => (
							<linearGradient key={line.id} id={`${fillId}-${index}`} x1="0" x2="0" y1="0" y2="1">
								<stop offset="0" style={{ stopColor: line.color }} data-part="fill-top" />
								<stop offset="1" style={{ stopColor: line.color }} data-part="fill-bottom" />
							</linearGradient>
						))}
					</defs>
					{ticks.map((tick, index) => (
						<g key={tick}>
							<line
								data-part={index === 0 ? 'baseline' : 'grid'}
								x1={plot.left}
								x2={plot.right}
								y1={yAt(tick)}
								y2={yAt(tick)}
							/>
							<text data-part="tick" x={plot.left - 10} y={yAt(tick)} textAnchor="end" dominantBaseline="central">
								{formatCompact(tick)}
							</text>
						</g>
					))}
					{labelIndexes.map((index, position) => (
						<text
							key={index}
							data-part="tick"
							x={xs[index]}
							y={plot.bottom + 20}
							textAnchor={labelAnchor(position, labelIndexes.length)}
						>
							{formatAxisDay(days[index])}
						</text>
					))}
					{active === null ? null : <line data-part="guide" x1={activeX} x2={activeX} y1={plot.top} y2={plot.bottom} />}
					{series.map((line, index) => {
						const points = pointsOf(line);

						return (
							<g key={line.id} data-part="series" data-highlight={highlight === line.id ? true : undefined}>
								<path data-part="area" d={smoothArea(points, plot.bottom)} fill={`url(#${fillId}-${index})`} />
								<path data-part="line" d={smoothLine(points)} style={{ stroke: line.color }} />
							</g>
						);
					})}
					{active === null
						? null
						: series
								.filter((line) => (line.values[active] ?? 0) > 0)
								.map((line) => (
									<circle
										key={line.id}
										data-part="dot"
										data-highlight={highlight === line.id ? true : undefined}
										cx={activeX}
										cy={yAt(line.values[active] ?? 0)}
										r={highlight === line.id ? 4.5 : 3.5}
										style={{ fill: line.color }}
									/>
								))}
				</svg>
			) : null}
			{active === null || tip === null ? null : (
				<>
					<div
						data-ui="chart-tooltip"
						data-side={flipped ? 'left' : 'right'}
						role="presentation"
						style={{
							top: MARGIN.top,
							transform: flipped
								? `translateX(calc(${activeX - TIP_GAP}px - 100%))`
								: `translateX(${activeX + TIP_GAP}px)`
						}}
					>
						<ChartTip
							heading={formatTipDay(days[active])}
							value={tip.total > 0 ? formatValue(tip.total) : NO_USAGE}
							rows={tipRows(tip, highlight, formatValue)}
						/>
					</div>
					<span className="sr-only" aria-live="polite">
						{formatTipDay(days[active])}: {tip.total > 0 ? formatValue(tip.total) : NO_USAGE}
						{tip.rows.map((row) => `, ${row.label} ${formatValue(row.value)}`).join('')}
					</span>
				</>
			)}
		</div>
	);
}
