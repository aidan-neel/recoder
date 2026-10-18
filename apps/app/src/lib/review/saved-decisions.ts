import type { DecisionState } from './surface';

export interface DecisionRecord {
	/** `open` once a decided item is opened again: the record stays, so its note comes back with the next decision. */
	state: DecisionState;
	/** What the person wants the author agent to know, for `sent` items. */
	note: string;
	at: number;
}

/** How every saved-decisions key begins; `decisionsKey` puts the review and its head commit after it. */
export const DECISIONS_PREFIX = 'recoder.decisions.v1.';

/** Where one review's decisions live: per head commit, so a new push starts clean. */
export function decisionsKey(reviewId: string, headSha: string): string {
	return `${DECISIONS_PREFIX}${reviewId}@${headSha}`;
}

/** Keys holding this review's decisions for commits other than `keep`; those are never read again. */
function earlierHeads(reviewId: string, keep: string): string[] {
	const prefix = `${DECISIONS_PREFIX}${reviewId}@`;
	const keys: string[] = [];

	for (let index = 0; index < localStorage.length; index++) {
		const key = localStorage.key(index);

		if (key && key !== keep && key.startsWith(prefix) && !key.slice(prefix.length).includes('@')) keys.push(key);
	}

	return keys;
}

const STATES = new Set<string>(['open', 'accepted', 'sent', 'dismissed']);

/** Keeps only well-formed records, so a hand-edited or stale entry never breaks the page. */
function validRecords(value: unknown): Record<string, DecisionRecord> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return {};

	const records: Record<string, DecisionRecord> = {};

	for (const [id, record] of Object.entries(value as Record<string, Partial<DecisionRecord>>)) {
		if (!record || !STATES.has(record.state as string)) continue;

		records[id] = {
			state: record.state as DecisionRecord['state'],
			note: typeof record.note === 'string' ? record.note : '',
			at: typeof record.at === 'number' ? record.at : 0
		};
	}

	return records;
}

/** Records from a stored value; a missing or unreadable one holds none. */
function parseRecords(stored: string | null): Record<string, DecisionRecord> {
	try {
		return validRecords(JSON.parse(stored ?? '{}'));
	} catch {
		return {};
	}
}

/** The decisions saved for a review at a commit; empty when there are none or storage is blocked. */
export function readDecisions(reviewId: string, headSha: string): Record<string, DecisionRecord> {
	try {
		return parseRecords(localStorage.getItem(decisionsKey(reviewId, headSha)));
	} catch {
		return {};
	}
}

/**
 * Saves the records of the items in `ids` into what is already stored, and
 * returns the merged decisions. Every other item keeps what storage holds, so
 * a page open in two tabs never writes back a copy the other tab has since
 * changed. The first save for a commit drops the ones saved for its earlier
 * commits, so storage does not grow with every push. A blocked or full
 * storage keeps `records` for this visit only.
 */
export function writeDecisions(
	reviewId: string,
	headSha: string,
	records: Record<string, DecisionRecord>,
	ids: readonly string[]
): Record<string, DecisionRecord> {
	const key = decisionsKey(reviewId, headSha);

	try {
		const stored = localStorage.getItem(key);

		if (stored === null) {
			for (const stale of earlierHeads(reviewId, key)) localStorage.removeItem(stale);
		}

		const merged = parseRecords(stored);

		for (const id of ids) {
			if (records[id]) merged[id] = records[id];
			else delete merged[id];
		}

		localStorage.setItem(key, JSON.stringify(merged));

		return merged;
	} catch {
		return records;
	}
}

/** Each decided item's state. An item opened again is open, so it is left out like one never decided. */
export function decisionStates(records: Record<string, DecisionRecord>): Record<string, DecisionState> {
	return Object.fromEntries(
		Object.entries(records).flatMap(([id, record]) => (record.state === 'open' ? [] : [[id, record.state]]))
	);
}
