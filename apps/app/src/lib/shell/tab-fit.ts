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
	/** The search trigger at full width, when space is tight, and as its icon alone, gap included. */
	search: Record<SearchSize, number>;
	/** The tab the page shows; it stays in the bar whenever it fits there beside the More menu. */
	active: string | null;
}

/** The search trigger's three widths: full, shrunk, and its icon alone for a bar with no room for either. */
export type SearchSize = 'wide' | 'narrow' | 'icon';

/** Which tabs show in the bar, which go into the More menu, and how wide the search trigger is. */
export interface TabFit {
	visible: string[];
	hidden: string[];
	search: SearchSize;
}

/** What the top bar measured, every length in CSS pixels, before the fit puts the page's tab in it. */
export interface BarMeasure {
	/** Room for the tab strip and the search trigger together. */
	room: number;
	/** The Queue tab. */
	queue: number;
	/** The line after the Queue tab while any review has a tab, in the bar or the More menu, gap included. */
	separator: number;
	tabs: readonly TabWidth[];
	/** The More menu's trigger. */
	more: number;
	/** The widest a review tab gets, gap included: most tabs are, since a title fills one to its cap. */
	widest: number;
	search: Record<SearchSize, number>;
}

/** What the fit lays out in any room: the pieces it measured. */
export type FitPieces = Omit<TabFitInput, 'room' | 'active'>;

/**
 * The fit's pieces from what the bar measured. `opening` is a review page
 * whose tab the bar has not measured yet: the tab opens as the review loads,
 * so until then it keeps the room of the widest tab at the end of the strip,
 * where it will join. The bar then takes the review page's shape at once and
 * the tab lands in its room.
 */
export function fitPieces(
	{ queue, separator, tabs, more, widest, search }: Omit<BarMeasure, 'room'>,
	opening: string | null
): FitPieces {
	const all =
		opening === null || tabs.some((tab) => tab.id === opening) ? tabs : [...tabs, { id: opening, width: widest }];

	return { fixed: queue + (all.length > 0 ? separator : 0), tabs: all, more, search };
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
 * taking the place of as many trailing tabs as it needs; a tab wider than the
 * whole budget goes into the menu too, so the bar never clips it.
 */
function overflowing(tabs: readonly TabWidth[], budget: number, active: string | null): TabWidth[] {
	const shown = leading(tabs, budget);
	const current = tabs.find((tab) => tab.id === active);

	if (current && !shown.includes(current) && current.width <= budget) {
		while (shown.length > 0 && total(shown) + current.width > budget) shown.pop();

		shown.push(current);
	}

	return shown;
}

function holdsActive(shown: TabWidth[], active: string | null): boolean {
	return shown.some((tab) => tab.id === active);
}

/** True when the shrunk search keeps a tab in the bar the full one would not: the active tab, else one more. */
function shrinkPays(wide: TabWidth[], narrow: TabWidth[], active: string | null): boolean {
	if (holdsActive(narrow, active) !== holdsActive(wide, active)) return holdsActive(narrow, active);

	return narrow.length > wide.length;
}

/**
 * Lays the bar out. Every tab shows while they fit beside the full search
 * trigger; next the trigger shrinks; past that the trailing tabs move into
 * the More menu, and the trigger shrinks only when that keeps one more tab,
 * or the active tab, in the bar. The active tab stays in the bar while it
 * fits there, even when that takes the trigger down to its icon; in a bar
 * too narrow for it, it waits in the More menu with the rest. A bar too
 * narrow for Queue and More beside the shrunk trigger (a phone) shows the
 * trigger as its icon alone.
 */
export function fitTabs({ room, fixed, tabs, more, search, active }: TabFitInput): TabFit {
	const ids = tabs.map((tab) => tab.id);
	const needed = fixed + total(tabs);

	if (needed <= room - search.wide) return { visible: ids, hidden: [], search: 'wide' };
	if (needed <= room - search.narrow) return { visible: ids, hidden: [], search: 'narrow' };

	const budget = (size: SearchSize) => room - search[size] - fixed - (tabs.length > 0 ? more : 0);
	const shown = (size: SearchSize) => overflowing(tabs, budget(size), active);

	const onlyIconKeepsActive = !holdsActive(shown('narrow'), active) && holdsActive(shown('icon'), active);

	let size: SearchSize = 'wide';

	if (budget('narrow') < 0 || onlyIconKeepsActive) size = 'icon';
	else if (budget('wide') < 0 || shrinkPays(shown('wide'), shown('narrow'), active)) size = 'narrow';

	const kept = new Set(shown(size).map((tab) => tab.id));

	return {
		visible: ids.filter((id) => kept.has(id)),
		hidden: ids.filter((id) => !kept.has(id)),
		search: size
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
