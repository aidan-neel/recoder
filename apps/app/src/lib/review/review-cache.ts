import type { FileDiff, PrCheck, PullRequest, Review, ReviewProgress } from '@recoder/shared';
import { whenIdle } from '@recoder/ui';

/** The last complete copy of a review the page showed, so a return visit paints it at once and refreshes in place. */
export interface CachedReview {
	review: Review;
	files: FileDiff[];
	pull: PullRequest | null;
	repoName: string | null;
	checks: PrCheck[] | null;
	/** The live progress. It stays in memory only: it can be large, and the stream sends a fresh one on connect. */
	progress: ReviewProgress | null;
	/** When the copy was kept, in ms; 0 for a copy an older page saved without the time. */
	keptAt: number;
	/** True for a copy read back from session storage: a reload reads the review again, however new the copy is. */
	reloaded: boolean;
}

/** A copy as a caller hands it over; the cache stamps when it was kept. */
type KeptReview = Omit<CachedReview, 'keptAt' | 'reloaded'>;

/** A copy as session storage holds it: without the progress, which stays in memory. */
type SavedReview = Omit<CachedReview, 'progress' | 'reloaded'>;

/** A copy kept this recently is as fresh as a new read, so a return visit does not read it again. */
const FRESH_MS = 10_000;

/** Reviews kept in memory, the most recent last. */
const MEMORY_LIMIT = 4;

/** Reviews kept in session storage, so a reload of the tab paints at once too. */
const SESSION_LIMIT = 2;

/** A copy longer than this stays out of session storage, which holds about 5 MB per site. */
const SESSION_MAX_CHARS = 1_500_000;

/** A session write put off until the page is idle runs by this time at the latest. */
const IDLE_WRITE_MS = 2000;

const PREFIX = 'recoder.review-cache.v1.';

/** The ids in session storage, the most recent first. */
const INDEX_KEY = `${PREFIX}index`;

const memory = new Map<string, CachedReview>();

/** Copies waiting for an idle moment to reach session storage, by review id; a newer copy replaces an older one. */
const unsaved = new Map<string, CachedReview>();

/** Where a kept copy goes besides memory: session storage now, once the page is idle, or not at all. */
type SessionWrite = 'now' | 'idle' | 'never';

/** Session storage, or null where the page cannot reach it (a server render, storage blocked). */
function session(): Storage | null {
	try {
		return typeof sessionStorage === 'undefined' ? null : sessionStorage;
	} catch {
		return null;
	}
}

function readIndex(store: Storage): string[] {
	try {
		const ids: unknown = JSON.parse(store.getItem(INDEX_KEY) ?? '[]');

		return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : [];
	} catch {
		return [];
	}
}

/** A copy saved by an earlier page in this tab; null when there is none or it does not read back. */
function fromSession(id: string): CachedReview | null {
	const store = session();

	try {
		const saved = JSON.parse(store?.getItem(PREFIX + id) ?? 'null') as SavedReview | null;

		if (saved?.review?.id !== id || !Array.isArray(saved.files)) return null;

		return { ...saved, progress: null, keptAt: Number(saved.keptAt) || 0, reloaded: true };
	} catch {
		return null;
	}
}

/** Makes `id` the most recent in memory, dropping the oldest past the limit. */
function touch(id: string, entry: CachedReview): void {
	memory.delete(id);
	memory.set(id, entry);

	for (const oldest of memory.keys()) {
		if (memory.size <= MEMORY_LIMIT) break;

		memory.delete(oldest);
	}
}

/** Writes one copy to session storage; false when it is too large to keep or storage refused it. */
function saveCopy(store: Storage, entry: CachedReview): boolean {
	const { review, files, pull, repoName, checks, keptAt } = entry;

	try {
		const text = JSON.stringify({ review, files, pull, repoName, checks, keptAt } satisfies SavedReview);

		if (text.length > SESSION_MAX_CHARS) return false;

		store.setItem(PREFIX + review.id, text);

		return true;
	} catch {
		return false;
	}
}

/** Removes one key from session storage. One storage refuses to remove only costs room, so the next writes go on. */
function removeKey(store: Storage, key: string): void {
	try {
		store.removeItem(key);
	} catch {}
}

/**
 * Saves a copy to session storage, keeping only the most recent few; a copy
 * that does not fit is skipped and its older copy dropped. It never throws,
 * so one refused write never stops the copies after it.
 */
function toSession(entry: CachedReview): void {
	const store = session();

	if (!store) return;

	const { id } = entry.review;
	const others = readIndex(store).filter((other) => other !== id);
	const saved = saveCopy(store, entry);
	const ids = saved ? [id, ...others] : others;

	if (!saved) removeKey(store, PREFIX + id);

	for (const old of ids.slice(SESSION_LIMIT)) removeKey(store, PREFIX + old);

	try {
		store.setItem(INDEX_KEY, JSON.stringify(ids.slice(0, SESSION_LIMIT)));
	} catch {}
}

/** Writes every copy still waiting for an idle moment, taking them off the list first, so a newer copy waits anew. */
function saveUnsaved(): void {
	const waiting = [...unsaved.values()];

	unsaved.clear();

	for (const entry of waiting) toSession(entry);
}

/** Saves a copy to session storage once the page is idle, so leaving a page never waits on it. */
function toSessionWhenIdle(entry: CachedReview): void {
	if (unsaved.size === 0) whenIdle(saveUnsaved, IDLE_WRITE_MS);

	unsaved.set(entry.review.id, entry);
}

/** The last copy of a review this tab showed, from memory or else from session storage; null when there is none. */
export function cachedReview(id: string): CachedReview | null {
	const entry = memory.get(id) ?? fromSession(id);

	if (entry) touch(id, entry);

	return entry;
}

/** True when a copy was kept moments ago, in this page, so it says what a new read would. */
export function isFresh(entry: CachedReview): boolean {
	return !entry.reloaded && Date.now() - entry.keptAt < FRESH_MS;
}

/**
 * Keeps a copy of a review. A page the person saw also goes to session
 * storage, at once (`now`, as the tab closes or reloads) or once the page is
 * idle (`idle`, as the person leaves it for another page, which then paints
 * without waiting on the write); a review read ahead for a tab they may open
 * next stays in memory (`never`).
 */
export function rememberReview(entry: KeptReview, write: SessionWrite = 'now'): void {
	const kept = { ...entry, keptAt: Date.now(), reloaded: false };

	touch(entry.review.id, kept);
	unsaved.delete(entry.review.id);

	if (write === 'now') toSession(kept);
	else if (write === 'idle') toSessionWhenIdle(kept);
}

/** Drops every copy of a review, once the server says it is gone. */
export function forgetReview(id: string): void {
	const store = session();

	memory.delete(id);
	unsaved.delete(id);

	if (!store) return;

	try {
		store.removeItem(PREFIX + id);
		store.setItem(INDEX_KEY, JSON.stringify(readIndex(store).filter((other) => other !== id)));
	} catch {}
}

if (typeof window !== 'undefined') window.addEventListener('pagehide', saveUnsaved);
