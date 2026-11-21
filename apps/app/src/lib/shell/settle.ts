import { create } from 'zustand';

import { readStoredJson, writeStored } from './browser-storage';
import type { RecentChat, RecentReview, SettledReview, SettledRow } from './types';

/** How long a chat rests before it settles on its own, in ms. */
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
 * Whether a review is settled: merged or closed pull requests settle on their own unless
 * brought back by hand, while open pull requests never auto-settle on a timer and only
 * settle when marked by hand (coming back automatically if the review updates later).
 */
export function isReviewSettled(id: string, updatedAt: string, ended: boolean, marks: SettleMarks): boolean {
	const changed = changedAt(updatedAt);
	const mark = marks[id];

	if (mark && (changed === null || mark.at >= changed)) return mark.settled;

	return ended;
}

/**
 * Whether a chat is settled: a mark made since its last change decides it, a
 * chat brought back rests again from that moment, and anything else settles
 * once it has been quiet for three hours.
 */
export function isChatSettled(id: string, updatedAt: string, marks: SettleMarks, now: number): boolean {
	const changed = changedAt(updatedAt);
	const mark = marks[id];

	if (mark && (changed === null || mark.at >= changed)) {
		return mark.settled || now - mark.at >= AUTO_SETTLE_MS;
	}

	return changed !== null && now - changed >= AUTO_SETTLE_MS;
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
	/** Reviews of merged or closed pull requests, settled by default unless unsettled by hand. */
	ended: SettledReview[];
	chats: RecentChat[];
}

/** The sort timestamp for a live review: its last change, or when it was explicitly unsettled if newer. */
function reviewActivityAt(review: RecentReview, marks: SettleMarks): number {
	const changed = changedAt(review.updatedAt) ?? 0;
	const mark = marks[review.reviewId];

	return mark && !mark.settled ? Math.max(changed, mark.at) : changed;
}

/** Splits the rows between the live lists and Settled, which is newest first. */
export function sidebarLists({ open, ended, chats }: ListInput, marks: SettleMarks, now: number): SidebarLists {
	const openSettled = (review: RecentReview) => isReviewSettled(review.reviewId, review.updatedAt, false, marks);
	const endedSettled = (review: SettledReview) => isReviewSettled(review.reviewId, review.updatedAt, true, marks);
	const chatSettled = (chat: RecentChat) => isChatSettled(chat.chatId, chat.updatedAt, marks, now);

	const liveReviews: RecentReview[] = [
		...open.filter((review) => !openSettled(review)),
		...ended.filter((review) => !endedSettled(review))
	].sort((a, b) => reviewActivityAt(b, marks) - reviewActivityAt(a, marks));

	const settled: SettledRow[] = [
		...ended.filter(endedSettled).map((row): SettledRow => ({ kind: 'review', row, outcome: row.outcome })),
		...open.filter(openSettled).map((row): SettledRow => ({ kind: 'review', row, outcome: null })),
		...chats.filter(chatSettled).map((row): SettledRow => ({ kind: 'chat', row, outcome: null }))
	];

	return {
		recent: liveReviews.slice(0, RECENT_LIMIT),
		chats: chats.filter((chat) => !chatSettled(chat)),
		settled: settled.sort((a, b) => (changedAt(b.row.updatedAt) ?? 0) - (changedAt(a.row.updatedAt) ?? 0))
	};
}

interface SettleState {
	marks: SettleMarks;
	/** Moves a row down to Settled. */
	settle: (id: string) => void;
	/** Brings a settled row back to its live list (keeps an explicit override for ended reviews and chats). */
	unsettle: (id: string) => void;
	/** Removes a manual settle mark on an open review so it still auto-settles once its pull request ends. */
	clear: (id: string) => void;
}

/** Persists `marks` to browser storage and updates the store. */
function saveMarks(marks: SettleMarks, set: (next: Partial<SettleState>) => void): void {
	writeStored(SETTLE_KEY, JSON.stringify(marks));
	set({ marks });
}

/** The rows a person settled or brought back, kept in this browser. */
export const useSettleMarks = create<SettleState>((set, get) => ({
	marks: typeof window === 'undefined' ? {} : readMarks(Date.now()),
	settle(id) {
		const now = Date.now();

		saveMarks({ ...fresh(get().marks, now), [id]: { settled: true, at: now } }, set);
	},
	unsettle(id) {
		const now = Date.now();

		saveMarks({ ...fresh(get().marks, now), [id]: { settled: false, at: now } }, set);
	},
	clear(id) {
		const now = Date.now();
		const next = fresh(get().marks, now);

		delete next[id];
		saveMarks(next, set);
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
