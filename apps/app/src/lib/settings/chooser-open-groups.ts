import { readStoredJson, writeStored } from '../shell/browser-storage';

const STORAGE_KEY = 'recoder-chooser-open-groups';

/** The group headings in a stored value; anything that is not a list of text is dropped. */
export function parseOpenGroups(value: unknown): Set<string> {
	if (!Array.isArray(value)) return new Set();

	return new Set(value.filter((heading): heading is string => typeof heading === 'string'));
}

/** The provider groups this viewer left open in the Models chooser. */
export function readOpenGroups(): Set<string> {
	return parseOpenGroups(readStoredJson(STORAGE_KEY));
}

/** Remembers which provider groups are open, in this browser. */
export function writeOpenGroups(headings: ReadonlySet<string>): void {
	writeStored(STORAGE_KEY, JSON.stringify([...headings].sort()));
}

/** The set with `heading` in it when `open`, without it otherwise. */
export function withOpenGroup(headings: ReadonlySet<string>, heading: string, open: boolean): Set<string> {
	const next = new Set(headings);

	if (open) next.add(heading);
	else next.delete(heading);

	return next;
}

/**
 * Whether a group shows its models. A search opens every group it lists, until
 * the viewer shuts one; otherwise a group is open only when the viewer left it so.
 */
export function isGroupOpen(
	heading: string,
	remembered: ReadonlySet<string>,
	chosenDuringSearch: ReadonlyMap<string, boolean>,
	searching: boolean
): boolean {
	return chosenDuringSearch.get(heading) ?? (searching || remembered.has(heading));
}
