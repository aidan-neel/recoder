/**
 * `localStorage`, read and written so that storage the browser blocks (a
 * private window, a sandboxed frame) or that is full only costs what it would
 * have kept: the page goes on with the value it already holds.
 */

function local(): Storage | null {
	try {
		return typeof localStorage === 'undefined' ? null : localStorage;
	} catch {
		return null;
	}
}

/** The stored text, or null when there is none or storage is blocked. */
export function readStored(key: string): string | null {
	try {
		return local()?.getItem(key) ?? null;
	} catch {
		return null;
	}
}

/** Saves the text; blocked or full storage keeps it only for this page. */
export function writeStored(key: string, value: string): void {
	try {
		local()?.setItem(key, value);
	} catch {}
}

/** The stored JSON, or null when there is none, it does not parse, or storage is blocked. */
export function readStoredJson(key: string): unknown {
	const text = readStored(key);

	if (text === null) return null;

	try {
		return JSON.parse(text) as unknown;
	} catch {
		return null;
	}
}
