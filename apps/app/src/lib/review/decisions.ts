import type { DecisionRecord } from './saved-decisions';
import type { DecisionState } from './surface';

/** One step back: the item that changed and the record it had before (none when it was never decided). */
export interface DecisionChange {
	id: string;
	before: DecisionRecord | undefined;
}

type Records = Record<string, DecisionRecord>;

/** The state an item is in; undecided items are open. */
export function stateOf(records: Records, id: string): DecisionState {
	return records[id]?.state ?? 'open';
}

/**
 * Records with `id` set to `state`, keeping its note. Setting a decided item
 * to `open` opens it again and keeps the note too, so deciding it again
 * brings the note back. Null when nothing would change.
 */
export function decide(
	records: Records,
	id: string,
	state: DecisionState,
	at: number
): { records: Records; change: DecisionChange } | null {
	const before = records[id];

	if (stateOf(records, id) === state) return null;

	return { records: { ...records, [id]: { state, note: before?.note ?? '', at } }, change: { id, before } };
}

/** Records with the note on a decided item replaced. An item never decided has no note, so it is left alone. */
export function withNote(records: Records, id: string, note: string): Records {
	const record = records[id];

	return record ? { ...records, [id]: { ...record, note } } : records;
}

/** Records with one change rolled back: the item returns to its earlier record, or to never decided. */
export function revert(records: Records, change: DecisionChange): Records {
	const { [change.id]: _current, ...rest } = records;

	return change.before ? { ...rest, [change.id]: change.before } : rest;
}
