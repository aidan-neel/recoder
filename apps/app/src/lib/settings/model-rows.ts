import { matchesQuery, ROLE_NAME, type ModelGroup, type ModelOption } from './model-options';

/** A model row, and the "Same as Review model" row, are 34px. */
const ROW_HEIGHT = 34;

/** A provider heading: 16px of text with 8px above and 5px below. */
const HEADING_HEIGHT = 29;

/** The list's padding above the first row (`[cmdk-list-sizer]` in the kit). */
const LIST_PAD = 8;

/** The row that unsets the subagent pick, so subagents follow the Review model. */
export const FOLLOW_LABEL = `Same as ${ROLE_NAME.orchestrator}`;

/** The id the follow row goes by in the list; no model id has a space in it. */
export const FOLLOW_ID = 'same as review';

export type ModelRow =
	| { kind: 'follow'; key: string }
	| { kind: 'heading'; key: string; label: string }
	| { kind: 'model'; key: string; option: ModelOption };

/** Every row of the list with where it sits; only the rows near the viewport mount. */
export interface RowLayout {
	rows: ModelRow[];
	/** Each row's top, in px from the top of the first row. */
	tops: number[];
	total: number;
	/** The indexes of the rows that can be chosen, top to bottom. */
	choices: number[];
	/** Each row's index by its key (a model id, or `FOLLOW_ID`). */
	index: Map<string, number>;
	/** The list's padding above the first row, in px. */
	pad: number;
	/** The root font scale the sizes above were measured at. */
	scale: number;
}

/**
 * A row's height at the root font `scale`. The CSS sizes compile to rem and
 * the root font grows on large screens, so the px here grow with it.
 */
function heightOf(row: ModelRow, scale: number): number {
	return (row.kind === 'heading' ? HEADING_HEIGHT : ROW_HEIGHT) * scale;
}

/**
 * The rows for a query: the follow row when it is offered and matches, then
 * each provider with a match under its heading. Providers with no match drop
 * out, heading and all. `scale` is the root font size over 16px.
 */
export function layoutRows(
	groups: readonly ModelGroup[],
	terms: readonly string[],
	follow: boolean,
	scale: number
): RowLayout {
	const rows: ModelRow[] = [];

	if (follow && terms.every((term) => FOLLOW_LABEL.toLowerCase().includes(term))) {
		rows.push({ kind: 'follow', key: FOLLOW_ID });
	}

	for (const group of groups) {
		const hits = terms.length ? group.options.filter((option) => matchesQuery(option, terms)) : group.options;

		if (hits.length === 0) continue;

		rows.push({ kind: 'heading', key: `heading:${group.heading}`, label: group.heading });

		for (const option of hits) rows.push({ kind: 'model', key: option.id, option });
	}

	const tops: number[] = [];
	const choices: number[] = [];
	const index = new Map<string, number>();
	let total = 0;

	rows.forEach((row, at) => {
		tops.push(total);
		total += heightOf(row, scale);
		index.set(row.key, at);

		if (row.kind !== 'heading') choices.push(at);
	});

	return { rows, tops, total, choices, index, pad: LIST_PAD * scale, scale };
}

/** The bottom edge of row `index`. */
export function rowBottom(layout: RowLayout, index: number): number {
	return layout.tops[index] + heightOf(layout.rows[index], layout.scale);
}

/** The first row whose bottom is below `y`, by binary search. */
function rowAt(layout: RowLayout, y: number): number {
	let low = 0;
	let high = layout.rows.length - 1;

	while (low < high) {
		const middle = (low + high) >> 1;

		if (rowBottom(layout, middle) <= y) low = middle + 1;
		else high = middle;
	}

	return low;
}

/**
 * The rows to mount for a scroll position: those within `overscan` px of the
 * viewport, plus any `pinned` row (the selected one stays mounted however far
 * it scrolls away). Sorted, without repeats.
 */
export function mountedRows(
	layout: RowLayout,
	scrollTop: number,
	viewport: number,
	overscan: number,
	pinned: readonly number[]
): number[] {
	if (layout.rows.length === 0) return [];

	const first = rowAt(layout, Math.max(0, scrollTop - overscan));
	const last = rowAt(layout, scrollTop + viewport + overscan);
	const indexes = new Set<number>();

	for (let index = first; index <= last; index++) indexes.add(index);

	for (const index of pinned) if (index >= 0 && index < layout.rows.length) indexes.add(index);

	return [...indexes].sort((a, b) => a - b);
}

/**
 * The scroll position that brings row `index` into view, moving as little as
 * possible; a group's first row brings its heading too. Rounded outward to
 * whole px, since a scaled row can end between pixels and the list scrolls by
 * whole ones.
 */
export function scrollToReveal(layout: RowLayout, index: number, scrollTop: number, viewport: number): number {
	const top = layout.rows[index - 1]?.kind === 'heading' ? layout.tops[index - 1] : layout.tops[index];
	const bottom = rowBottom(layout, index);

	if (top < scrollTop) return Math.floor(top);
	if (bottom > scrollTop + viewport) return Math.ceil(bottom - viewport);

	return scrollTop;
}

/** The scroll position that puts row `index` in the middle of the viewport, as far as the list allows. */
export function scrollToCenter(layout: RowLayout, index: number, viewport: number): number {
	const middle = layout.tops[index] + heightOf(layout.rows[index], layout.scale) / 2;

	return Math.max(0, Math.min(layout.total - viewport, middle - viewport / 2));
}

/** How far each key moves the selection; Home and End jump to the ends. */
const STEPS: Record<string, number> = { ArrowDown: 1, ArrowUp: -1, PageDown: 8, PageUp: -8 };

/**
 * The row a key press moves the selection to, from the row with key `from`:
 * arrows wrap around the ends, Page keys stop at them. Null for any other key
 * or an empty list. With no selection, Down lands on the first row and Up on the last.
 */
export function stepChoice(layout: RowLayout, from: string | null, key: string): number | null {
	const { choices } = layout;
	const last = choices.length - 1;

	if (last < 0) return null;
	if (key === 'Home') return choices[0];
	if (key === 'End') return choices[last];

	const step = STEPS[key];

	if (!step) return null;

	const at = choices.indexOf(from === null ? -1 : (layout.index.get(from) ?? -1));

	if (at < 0) return choices[step > 0 ? 0 : last];
	if (Math.abs(step) === 1) return choices[(at + step + choices.length) % choices.length];

	return choices[Math.max(0, Math.min(last, at + step))];
}
