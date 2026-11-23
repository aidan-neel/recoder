import { create } from 'zustand';

/** The rows of the sidebar's Reviews and Chats picked for one action on them all. */
export interface RowSelection {
	ids: readonly string[];
	/** The row last opened or toggled: a Shift-click or Shift+arrow selects from it. */
	anchor: string | null;
}

/** How a click on a row picks: a plain click opens it, Shift selects a range, Cmd or Ctrl adds or drops one row. */
export type PickHow = 'open' | 'range' | 'toggle';

/** The rows of `order` from `from` to `to`, both included, in list order. */
function span(order: readonly string[], from: string, to: string): string[] {
	const start = order.indexOf(from);
	const end = order.indexOf(to);

	return order.slice(Math.min(start, end), Math.max(start, end) + 1);
}

/** The anchor a range runs from: the selection's own while it is still listed, else `fallback`. */
function anchorIn(selection: RowSelection, order: readonly string[], fallback: string): string {
	return selection.anchor !== null && order.includes(selection.anchor) ? selection.anchor : fallback;
}

/**
 * The selection after a click on `id`, as a Mac list picks: a plain click empties it and makes the row the anchor,
 * Shift selects every row from the anchor to it, and Cmd or Ctrl adds or drops it alone and makes it the anchor.
 * `order` is every selectable row as the sidebar lists them.
 */
export function pick(selection: RowSelection, order: readonly string[], id: string, how: PickHow): RowSelection {
	if (how === 'open' || !order.includes(id)) return { ids: [], anchor: id };

	if (how === 'range') {
		const anchor = anchorIn(selection, order, id);

		return { ids: span(order, anchor, id), anchor };
	}

	const ids = selection.ids.includes(id) ? selection.ids.filter((other) => other !== id) : [...selection.ids, id];

	return { ids: order.filter((other) => ids.includes(other)), anchor: id };
}

/**
 * Shift+arrow from the focused row `from`: the row `step` away takes focus and the selection runs from the anchor to
 * it, starting at `from` when nothing is selected. Null at either end of the list.
 */
export function extend(
	selection: RowSelection,
	order: readonly string[],
	from: string,
	step: 1 | -1
): { selection: RowSelection; focus: string } | null {
	const at = order.indexOf(from);
	const focus = at < 0 ? undefined : order[at + step];

	if (focus === undefined) return null;

	const anchor = selection.ids.length > 0 ? anchorIn(selection, order, from) : from;

	return { selection: { ids: span(order, anchor, focus), anchor }, focus };
}

interface SelectionState extends RowSelection {
	set: (selection: RowSelection) => void;
	/** Empties the selection and keeps the anchor. */
	clear: () => void;
}

/** The sidebar's selection, for this visit only. */
export const useRowSelection = create<SelectionState>((set) => ({
	ids: [],
	anchor: null,
	set: (selection) => set(selection),
	clear: () => set({ ids: [] })
}));
