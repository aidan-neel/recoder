/**
 * Last-seen server data kept in localStorage so a page can paint real content
 * on the first frame after mount and revalidate behind it. Read it inside
 * onMount paths only: the server render has no storage, and seeding earlier
 * would mismatch on hydration.
 */
const PREFIX = 'recoder.cache.v1.';
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export function readCache<T>(key: string): T | null {
	try {
		if (typeof localStorage === 'undefined') return null;
		const raw = localStorage.getItem(PREFIX + key);
		if (!raw) return null;
		const entry = JSON.parse(raw) as { at: number; value: T };
		return Date.now() - entry.at < MAX_AGE_MS ? entry.value : null;
	} catch {
		return null;
	}
}

export function writeCache(key: string, value: unknown): void {
	try {
		localStorage.setItem(PREFIX + key, JSON.stringify({ at: Date.now(), value }));
	} catch {
		// Storage full or blocked; the page just loads from the network.
	}
}
