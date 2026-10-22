/** A review tab's id and the room it takes in the bar, gap included. */
interface TabWidth {
	id: string;
	width: number;
}

/** What the top bar measured: every length in CSS pixels. */
export interface TabFitInput {
	/** Room for the tab strip and the search trigger together. */
	room: number;
	/** The Queue tab, plus the separator while any review is open. */
	fixed: number;
	tabs: readonly TabWidth[];
	/** The More menu's trigger. */
	more: number;
	/** The search trigger at full width and when space is tight, gap included. */
	search: { wide: number; narrow: number };
	/** The tab the page shows; it stays in the bar even when it would overflow. */
	active: string | null;
}

/** Which tabs show in the bar, which go into the More menu, and whether the search trigger shrinks. */
export interface TabFit {
	visible: string[];
	hidden: string[];
	compact: boolean;
}

function total(tabs: readonly TabWidth[]): number {
	return tabs.reduce((sum, tab) => sum + tab.width, 0);
}

/** The leading tabs that fit in `budget`, in order. */
function leading(tabs: readonly TabWidth[], budget: number): TabWidth[] {
	const shown: TabWidth[] = [];
	let used = 0;

	for (const tab of tabs) {
		if (used + tab.width > budget) break;

		shown.push(tab);
		used += tab.width;
	}

	return shown;
}

/**
 * The tabs that fit in `budget` beside the More menu. The active tab stays,
 * taking the place of as many trailing tabs as it needs.
 */
function overflowing(tabs: readonly TabWidth[], budget: number, active: string | null): TabWidth[] {
	const shown = leading(tabs, budget);
	const current = tabs.find((tab) => tab.id === active);

	if (current && !shown.includes(current)) {
		while (shown.length > 0 && total(shown) + current.width > budget) shown.pop();

		shown.push(current);
	}

	return shown;
}

/**
 * Lays the bar out. Every tab shows while they fit beside the full search
 * trigger; next the trigger shrinks; past that the trailing tabs move into
 * the More menu, and the trigger shrinks only when that keeps one more tab
 * in the bar. The active tab always stays in the bar.
 */
export function fitTabs({ room, fixed, tabs, more, search, active }: TabFitInput): TabFit {
	const ids = tabs.map((tab) => tab.id);
	const needed = fixed + total(tabs);

	if (needed <= room - search.wide) return { visible: ids, hidden: [], compact: false };
	if (needed <= room - search.narrow) return { visible: ids, hidden: [], compact: true };

	const wide = overflowing(tabs, room - search.wide - fixed - more, active);
	const narrow = overflowing(tabs, room - search.narrow - fixed - more, active);
	const compact = narrow.length > wide.length;
	const kept = new Set((compact ? narrow : wide).map((tab) => tab.id));

	return {
		visible: ids.filter((id) => kept.has(id)),
		hidden: ids.filter((id) => !kept.has(id)),
		compact
	};
}

/**
 * Where to go when tabs close under the open review: the nearest tab that
 * stays, to the right first and then to the left, or null for the queue.
 */
export function neighborAfterClose(ids: readonly string[], closing: readonly string[], active: string): string | null {
	const at = ids.indexOf(active);
	const stays = (id: string) => !closing.includes(id);

	return ids.slice(at + 1).find(stays) ?? ids.slice(0, Math.max(at, 0)).findLast(stays) ?? null;
}
