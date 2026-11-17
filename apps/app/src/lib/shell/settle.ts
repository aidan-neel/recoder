import { create } from 'zustand';

import { readStoredJson, writeStored } from './browser-storage';
import type { RecentChat, RecentReview, SettledReview, SettledRow } from './types';

/** How long a chat or review rests before it settles on its own, in ms. */
export const AUTO_SETTLE_MS = 3 * 60 * 60 * 1000;

/** How long a mark is kept after it was made, so the marks of deleted rows do not pile up, in ms. */
const MARK_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** How many reviews the sidebar lists above Settled. */
const RECENT_LIMIT = 8;

/** Where the marks are kept in this browser. */
const SETTLE_KEY = 'recoder.sidebar-settled.v1';

/** A person settled a row, or brought it back, at `at` (epoch ms). */
export interface SettleMark {
	settled: boolean;
	at: number;
}

export type SettleMarks = Readonly<Record<string, SettleMark>>;

/** When the row last changed, in epoch ms; null when the date does not parse. */
function changedAt(updatedAt: string): number | null {
	const at = Date.parse(updatedAt);

	return Number.isNaN(at) ? null : at;
}

/**
 * Whether a row is settled: a mark made since its last change decides it, a
 * row brought back rests again from that moment, and anything else settles
 * once it has been quiet for three hours. A busy row (a review that runs)
 * never settles on its own.
 */
export function isSettled(id: string, updatedAt: string, marks: SettleMarks, now: number, busy = false): boolean {
	const changed = changedAt(updatedAt);
	const mark = marks[id];

	if (mark && (changed === null || mark.at >= changed)) {
		return mark.settled || (!busy && now - mark.at >= AUTO_SETTLE_MS);
	}

	return !busy && changed !== null && now - changed >= AUTO_SETTLE_MS;
}

/** The sidebar's three lists once settling is applied. */
export interface SidebarLists {
	recent: RecentReview[];
	chats: RecentChat[];
	settled: SettledRow[];
}

interface ListInput {
	/** Reviews of pull requests still open, newest first. */
	open: RecentReview[];
	/** Reviews of merged or closed pull requests, which are always settled. */
	ended: SettledReview[];
	chats: RecentChat[];
}

/** Splits the rows between the live lists and Settled, which is newest first. */
export function sidebarLists({ open, ended, chats }: ListInput, marks: SettleMarks, now: number): SidebarLists {
	const busy = (review: RecentReview) => review.state === 'running' || review.state === 'queued';

	const reviewSettled = (review: RecentReview) =>
		isSettled(review.reviewId, review.updatedAt, marks, now, busy(review));

	const chatSettled = (chat: RecentChat) => isSettled(chat.chatId, chat.updatedAt, marks, now);

	const settled: SettledRow[] = [
		...ended.map((row): SettledRow => ({ kind: 'review', row, outcome: row.outcome })),
		...open.filter(reviewSettled).map((row): SettledRow => ({ kind: 'review', row, outcome: null })),
		...chats.filter(chatSettled).map((row): SettledRow => ({ kind: 'chat', row, outcome: null }))
	];

	return {
		recent: open.filter((review) => !reviewSettled(review)).slice(0, RECENT_LIMIT),
		chats: chats.filter((chat) => !chatSettled(chat)),
		settled: settled.sort((a, b) => (changedAt(b.row.updatedAt) ?? 0) - (changedAt(a.row.updatedAt) ?? 0))
	};
}

interface SettleState {
	marks: SettleMarks;
	/** Settles a row, or brings it back with `settled` false. */
	mark: (id: string, settled: boolean) => void;
}

/** The rows a person settled or brought back, kept in this browser. */
export const useSettleMarks = create<SettleState>((set, get) => ({
	marks: typeof window === 'undefined' ? {} : readMarks(Date.now()),
	mark(id, settled) {
		const now = Date.now();
		const marks = { ...fresh(get().marks, now), [id]: { settled, at: now } };

		writeStored(SETTLE_KEY, JSON.stringify(marks));
		set({ marks });
	}
}));

/** The marks made within the last month. */
function fresh(marks: SettleMarks, now: number): Record<string, SettleMark> {
	return Object.fromEntries(Object.entries(marks).filter(([, mark]) => now - mark.at < MARK_TTL_MS));
}

function isMark(value: unknown): value is SettleMark {
	if (typeof value !== 'object' || value === null) return false;

	const { settled, at } = value as Record<string, unknown>;

	return typeof settled === 'boolean' && typeof at === 'number';
}

/** The saved marks; none when nothing is saved, it does not parse, or storage is blocked. */
function readMarks(now: number): SettleMarks {
	const saved = readStoredJson(SETTLE_KEY);

	if (typeof saved !== 'object' || saved === null) return {};

	const marks = Object.fromEntries(Object.entries(saved).filter(([, mark]) => isMark(mark))) as SettleMarks;

	return fresh(marks, now);
}
