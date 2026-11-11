import type { Surface } from './surface.js';
import { padEnd, padStart, visibleWidth } from './text.js';

const COLUMN_GAP = 3;

/** One column of a table: its heading, and whether its cells line up on the right. */
export interface TableColumn {
	heading: string;
	alignRight?: boolean;
}

/** Rows under muted headings, each column as wide as its widest cell. Cells may be styled. */
export function renderTable(columns: readonly TableColumn[], rows: readonly string[][], surface: Surface): string[] {
	const widths = columns.map((column, index) =>
		Math.max(visibleWidth(column.heading), ...rows.map((row) => visibleWidth(row[index] ?? '')))
	);

	const layOut = (cells: readonly string[]): string =>
		cells
			.map((cell, index) => (columns[index].alignRight ? padStart(cell, widths[index]) : padEnd(cell, widths[index])))
			.join(' '.repeat(COLUMN_GAP))
			.trimEnd();

	const headings = layOut(columns.map((column) => column.heading));

	return [surface.paint.muted(headings), ...rows.map(layOut)];
}
