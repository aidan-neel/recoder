import type { BarRow, BarValue } from '$lib/charts/types';
import { percent, recall } from './stats';
import type { Totals } from './types';

/** A recall bar: the share found, with the counts beside it. */
export function recallBar(totals: Totals | undefined): BarValue | null {
	const share = recall(totals);

	return share === null || !totals
		? null
		: { value: share, text: percent(share), detail: `${totals.found}/${totals.planted}` };
}

/** Rows for groups of totals in each of several reports, ordered by the first report's recall, then name. */
export function recallRows(groups: (Record<string, Totals> | undefined)[], label = (key: string) => key): BarRow[] {
	const keys = [...new Set(groups.flatMap((group) => Object.keys(group ?? {})))];
	const first = groups[0] ?? {};

	return keys
		.toSorted((a, b) => (recall(first[b]) ?? -1) - (recall(first[a]) ?? -1) || a.localeCompare(b))
		.map((key) => ({ key, label: label(key), values: groups.map((group) => recallBar(group?.[key])) }));
}

/** `bug` → `Bugs`, `quality` → `Quality`. */
export function kindLabel(kind: string): string {
	return kind === 'bug' ? 'Bugs' : kind === 'quality' ? 'Quality' : kind;
}

/** `null-check` → `Null check`. */
export function categoryLabel(category: string): string {
	const words = category.replaceAll(/[-_]/g, ' ');

	return words.charAt(0).toUpperCase() + words.slice(1);
}
