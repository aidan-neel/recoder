import type { TipRow } from './tip';

/** A legend entry; `shape` matches the mark it names. */
export interface LegendItem {
	label: string;
	color: string;
	shape?: 'square' | 'dot' | 'ring';
}

/** One bar: its value on the shared scale, and the text shown beside it. */
export interface BarValue {
	value: number;
	text: string;
	detail?: string;
}

/** A labeled row with one bar per series; null leaves that series' bar empty. */
export interface BarRow {
	key: string;
	label: string;
	sub?: string;
	values: (BarValue | null)[];
}

/** A series a chart's values belong to, in order. */
export interface Series {
	label: string;
	color: string;
}

/** One part of a stacked bar. */
export interface Segment {
	key: string;
	label: string;
	value: number;
	color: string;
}

/** A bar made of parts, labeled above it when there are several bars. */
export interface StackRow {
	key: string;
	label: string;
	segments: Segment[];
}

/** A point on an x/y chart; points that share `series` are joined when the chart draws lines. */
export interface XyPoint {
	x: number;
	y: number;
	series: string;
	color: string;
	title: string;
	rows: TipRow[];
	href?: string;
	/** Drawn as a ring, for a point that is not final (a run in progress). */
	hollow?: boolean;
}

/** How far a planted defect got in one run; `none` when the run has no score. */
export type CellStage = 'published' | 'verified' | 'found' | 'missed' | 'none';

/** One defect's row in the grid: a cell per run. */
export interface DefectRow {
	id: string;
	title: string;
	sub: string;
	cells: { stage: CellStage; rows: TipRow[] }[];
}

/** The defects of one PR. */
export interface DefectGroup {
	pr: string;
	defects: DefectRow[];
}
