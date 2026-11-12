/**
 * `localStorage`, read and written so that storage the browser blocks (a
 * private window, a sandboxed frame) or that is full only costs what it would
 * have kept: the page goes on with the value it already holds.
 */

/** `DOMException` names of storage the browser blocks (`SecurityError`) or that is full (the others, by browser). */
const REFUSALS = new Set(['SecurityError', 'QuotaExceededError', 'NS_ERROR_DOM_QUOTA_REACHED']);

function local(): Storage | null {
	try {
		return typeof localStorage === 'undefined' ? null : localStorage;
	} catch (error) {
		rethrowUnlessRefused(error);

		return null;
	}
}

/** The stored text, or null when there is none or storage is blocked. */
export function readStored(key: string): string | null {
	try {
		return local()?.getItem(key) ?? null;
	} catch (error) {
		rethrowUnlessRefused(error);

		return null;
	}
}

/** Saves the text; blocked or full storage keeps it only for this page. */
export function writeStored(key: string, value: string): void {
	try {
		local()?.setItem(key, value);
	} catch (error) {
		rethrowUnlessRefused(error);
	}
}

/** The stored JSON, or null when there is none, it does not parse, or storage is blocked. */
export function readStoredJson(key: string): unknown {
	const text = readStored(key);

	if (text === null) return null;

	try {
		const parsed: unknown = JSON.parse(text);

		return parsed;
	} catch (error) {
		if (error instanceof SyntaxError) return null;

		throw error;
	}
}

/** Throws `error` again unless it is the browser refusing storage, which only costs what storage would have kept. */
function rethrowUnlessRefused(error: unknown): void {
	if (error instanceof DOMException && REFUSALS.has(error.name)) return;

	throw error;
}
