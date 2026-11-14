/** The pure parts of the kit's charts: ticks, point layout, smooth curves and number labels. */

const NICE_STEPS = [1, 2, 5, 10] as const;

/** Compact-number suffixes, one per factor of 1,000. */
const SUFFIXES = ['', 'K', 'M', 'B', 'T'] as const;

/**
 * Evenly spaced axis values from 0 up to the first multiple of a round step
 * (1, 2 or 5 times a power of ten) at or above `max`, about `target` of them.
 * A chart with nothing to show still gets a 0 to 1 axis.
 */
export function niceTicks(max: number, target = 4): number[] {
	if (!(max > 0)) return [0, 1];

	const rough = max / target;
	const magnitude = 10 ** Math.floor(Math.log10(rough));
	const step = (NICE_STEPS.find((factor) => factor * magnitude >= rough) ?? 10) * magnitude;
	const count = Math.ceil(max / step - 1e-9);

	return Array.from({ length: count + 1 }, (_, index) => index * step);
}

/** A count as three significant digits with a K, M, B or T suffix: 733M, 1.08B, 42.8B. Trailing zeros are dropped. */
export function formatCompact(value: number): string {
	const sign = value < 0 ? '-' : '';
	const magnitude = Math.abs(value);

	if (magnitude < 1000) return `${sign}${Math.round(magnitude)}`;

	let tier = Math.min(SUFFIXES.length - 1, Math.floor(Math.log10(magnitude) / 3));
	let scaled = Number((magnitude / 1000 ** tier).toPrecision(3));

	if (scaled >= 1000 && tier < SUFFIXES.length - 1) {
		tier += 1;
		scaled = Number((magnitude / 1000 ** tier).toPrecision(3));
	}

	return `${sign}${scaled}${SUFFIXES[tier]}`;
}

/** The fewest labels worth dropping a count for, so that the gaps between labels come out whole. */
const MIN_EVEN_LABELS = 3;

/**
 * Indexes for up to `wanted` labels along an axis of `count` points, the
 * first and last included. When some number of labels gives whole gaps (7
 * days: 0, 2, 4, 6), that many are used; otherwise the gaps are rounded.
 */
export function tickIndexes(count: number, wanted: number): number[] {
	if (count <= 0) return [];
	if (count === 1 || wanted <= 1) return [0];

	const most = Math.min(count, wanted);

	const even = Array.from({ length: most }, (_, labels) => most - labels).find(
		(labels) => labels >= MIN_EVEN_LABELS && (count - 1) % (labels - 1) === 0
	);

	const labels = even ?? most;

	return Array.from({ length: labels }, (_, index) => Math.round((index * (count - 1)) / (labels - 1)));
}

/** A point of a line, in the chart's pixels. */
export interface PlotPoint {
	x: number;
	y: number;
}

/** Where each of `count` points sits along the axis: the first on `left`, the last on `right`, the rest evenly between. */
export function pointXs(count: number, left: number, right: number): number[] {
	if (count <= 0) return [];
	if (count === 1) return [(left + right) / 2];

	const step = (right - left) / (count - 1);

	return Array.from({ length: count }, (_, index) => left + index * step);
}

/** The point nearest `x` along the axis, or null when `x` is left or right of the plot. */
export function nearestPoint(x: number, left: number, right: number, count: number): number | null {
	if (count <= 0 || right <= left || x < left || x > right) return null;
	if (count === 1) return 0;

	return Math.min(count - 1, Math.max(0, Math.round(((x - left) / (right - left)) * (count - 1))));
}

/** One line's mark on the hovered day: its id and where it sits, in the chart's pixels. */
export interface SeriesMark {
	id: string;
	y: number;
}

/**
 * The line whose mark on the hovered day is nearest the pointer's `y`, if one
 * is within `reach` pixels; a tie goes to the line listed first.
 */
export function nearestSeries(marks: readonly SeriesMark[], y: number, reach: number): string | null {
	let nearest: SeriesMark | null = null;

	for (const mark of marks) {
		if (Math.abs(mark.y - y) > reach) continue;
		if (!nearest || Math.abs(mark.y - y) < Math.abs(nearest.y - y)) nearest = mark;
	}

	return nearest?.id ?? null;
}

/** A segment's slope, or 0 for two points at one x. */
function slope(from: PlotPoint, to: PlotPoint): number {
	return to.x === from.x ? 0 : (to.y - from.y) / (to.x - from.x);
}

/**
 * The tangent at each point for a monotone curve (Fritsch and Carlson): the
 * curve never swings past a point's neighbours, so a run of zeros stays flat
 * on the baseline and a peak is never drawn higher than its value.
 */
function monotoneTangents(points: readonly PlotPoint[]): number[] {
	const slopes = points.slice(1).map((point, index) => slope(points[index], point));

	const tangents = points.map((_, index) => {
		if (index === 0) return slopes[0];
		if (index === points.length - 1) return slopes[index - 1];
		if (slopes[index - 1] * slopes[index] <= 0) return 0;

		return (slopes[index - 1] + slopes[index]) / 2;
	});

	slopes.forEach((segment, index) => {
		if (segment === 0) {
			tangents[index] = 0;
			tangents[index + 1] = 0;

			return;
		}

		const before = tangents[index] / segment;
		const after = tangents[index + 1] / segment;
		const length = Math.hypot(before, after);

		if (length <= 3) return;

		tangents[index] = (3 / length) * before * segment;
		tangents[index + 1] = (3 / length) * after * segment;
	});

	return tangents;
}

/** An SVG path through the points as a smooth monotone curve; a single point is a dot-sized move. */
export function smoothLine(points: readonly PlotPoint[]): string {
	if (points.length === 0) return '';
	if (points.length === 1) return `M${points[0].x},${points[0].y}`;

	const tangents = monotoneTangents(points);

	const segments = points.slice(1).map((point, index) => {
		const from = points[index];
		const third = (point.x - from.x) / 3;

		return `C${from.x + third},${from.y + tangents[index] * third} ${point.x - third},${point.y - tangents[index + 1] * third} ${point.x},${point.y}`;
	});

	return `M${points[0].x},${points[0].y}${segments.join('')}`;
}

/** The same curve closed down to `baseline`, for the fill under a line. */
export function smoothArea(points: readonly PlotPoint[], baseline: number): string {
	if (points.length < 2) return '';

	return `${smoothLine(points)}L${points[points.length - 1].x},${baseline}L${points[0].x},${baseline}Z`;
}

/** The most a day's tooltip lists before it folds the smallest into one line. */
const MAX_TIP_ROWS = 7;

/** One series' value on the hovered day. */
export interface TipValue {
	id: string;
	label: string;
	color: string;
	value: number;
}

/** What a day's tooltip lists: the day's total, the biggest series first, and what the rest add up to. */
export interface DayTip {
	total: number;
	rows: TipValue[];
	/** The series folded into one line, and their sum. */
	rest: { count: number; value: number } | null;
}

interface TipSeries {
	id: string;
	label: string;
	color: string;
	values: readonly number[];
}

/** The series with a value on day `index`, biggest first. */
export function dayValues(series: readonly TipSeries[], index: number): TipValue[] {
	return series
		.map((line) => ({ id: line.id, label: line.label, color: line.color, value: line.values[index] ?? 0 }))
		.filter((line) => line.value > 0)
		.sort((a, b) => b.value - a.value);
}

/** The series with a value on day `index`, biggest first, at most `maxRows` of them. */
export function dayTip(series: readonly TipSeries[], index: number, maxRows = MAX_TIP_ROWS): DayTip {
	const present = dayValues(series, index);
	const folded = present.slice(maxRows);

	return {
		total: present.reduce((sum, line) => sum + line.value, 0),
		rows: present.slice(0, maxRows),
		rest: folded.length > 0 ? { count: folded.length, value: folded.reduce((sum, line) => sum + line.value, 0) } : null
	};
}

/** A share of a whole as a percentage with one decimal: 90.7%. A sliver that would round to nothing reads <0.1%. */
export function formatShare(share: number): string {
	if (share > 0 && share < 0.0005) return '<0.1%';

	return `${(share * 100).toFixed(1)}%`;
}
