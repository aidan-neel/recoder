import { useEffect } from 'react';
import { create } from 'zustand';

import { readStoredJson, writeStored } from './browser-storage';

/** Where this browser keeps what it has seen. */
const SEEN_KEY = 'recoder.sidebar-seen.v1';

/** How long a row's mark is kept after the change it saw, so the marks of deleted rows do not pile up, in ms. */
const SEEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * What this browser has seen: when it started keeping marks, and for each row the
 * last change it was open for, both in epoch ms. A mark holds the row's own change
 * time, never this clock, so a server clock ahead of the browser marks nothing new.
 */
export interface SeenMarks {
	since: number;
	at: Readonly<Record<string, number>>;
}

/**
 * Whether a row changed after it was last open here. A row with no mark is new
 * only if it changed after this browser started keeping marks, so the first
 * visit shows nothing unread. A busy row (a review that runs) is never unread:
 * it becomes so when its result lands.
 */
export function isUnread(id: string, updatedAt: string, marks: SeenMarks, busy = false): boolean {
	if (busy) return false;

	const changed = Date.parse(updatedAt);

	if (Number.isNaN(changed)) return false;

	return changed > (marks.at[id] ?? marks.since);
}

/** The marks whose change is under a month old. */
function fresh(at: Readonly<Record<string, number>>, now: number): Record<string, number> {
	return Object.fromEntries(Object.entries(at).filter(([, seen]) => now - seen < SEEN_TTL_MS));
}

/** The saved marks; a new start, saved at once, when nothing valid is saved or storage is blocked. */
export function readSeen(now: number): SeenMarks {
	const saved = readStoredJson(SEEN_KEY);

	if (typeof saved === 'object' && saved !== null) {
		const { since, at } = saved as Record<string, unknown>;

		if (typeof since === 'number' && typeof at === 'object' && at !== null) {
			const valid = Object.entries(at).filter(([, seen]) => typeof seen === 'number');

			return { since, at: fresh(Object.fromEntries(valid) as Record<string, number>, now) };
		}
	}

	const start = { since: now, at: {} };

	writeStored(SEEN_KEY, JSON.stringify(start));

	return start;
}

interface SeenState {
	marks: SeenMarks;
	/** Marks the row's change at `updatedAt` as seen; an older change or one already seen changes nothing. */
	see: (id: string, updatedAt: string) => void;
}

/** The rows this browser has had open, so a row that changed since shows as unread in the sidebar. */
const useSeenMarks = create<SeenState>((set, get) => ({
	marks: typeof window === 'undefined' ? { since: 0, at: {} } : readSeen(Date.now()),
	see(id, updatedAt) {
		const { marks } = get();

		if (!isUnread(id, updatedAt, marks)) return;

		const next = { since: marks.since, at: { ...fresh(marks.at, Date.now()), [id]: Date.parse(updatedAt) } };

		writeStored(SEEN_KEY, JSON.stringify(next));
		set({ marks: next });
	}
}));

/** The row a list has open, if any: it counts as seen while it is open, through every change. */
interface OpenRow {
	id: string;
	updatedAt: string;
	busy: boolean;
}

/**
 * Whether each row of a list is unread. The open row never is, and each change it
 * goes through while open (a review landing) is marked seen as it arrives.
 */
export function useUnread(open: OpenRow | undefined): (id: string, updatedAt: string, busy?: boolean) => boolean {
	const marks = useSeenMarks((state) => state.marks);
	const see = useSeenMarks((state) => state.see);
	const openId = open?.id;
	const openAt = open?.updatedAt;
	const openBusy = open?.busy ?? false;

	useEffect(() => {
		if (openId && openAt && !openBusy) see(openId, openAt);
	}, [openId, openAt, openBusy, see]);

	return (id, updatedAt, busy = false) => id !== openId && isUnread(id, updatedAt, marks, busy);
}
