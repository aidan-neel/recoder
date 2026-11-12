/** What the page says when one of the app's scripts did not load. */
export const LOST_CHUNK_TEXT = 'Part of Recoder didn’t load.';

/** Where the time of the last reload for a lost chunk is kept, for this browser tab only. */
const RELOADED_KEY = 'recoder.app.chunk-reload';

/**
 * A second lost chunk this soon after a reload is not fixed by reloading
 * again, so the page shows its notice instead.
 */
const AGAIN_MS = 30_000;

/** What decides a reload: the tab's session storage, and the reload itself. */
export interface ReloadDeps {
	storage: Pick<Storage, 'getItem' | 'setItem'>;
	reload: () => void;
	now: number;
}

/**
 * True for an error thrown because a script or stylesheet of the app failed to
 * load: the dev server restarted, or a new build replaced the files the page
 * was built from. Turbopack names it `ChunkLoadError`.
 */
export function isChunkError(error: unknown): boolean {
	if (!(error instanceof Error)) return false;

	return (
		error.name === 'ChunkLoadError' ||
		/Failed to load chunk|Loading (CSS )?chunk .+ failed|dynamically imported module/i.test(error.message)
	);
}

/** The browser's own session storage and reload, or null on the server or when storage is blocked. */
function browserDeps(): ReloadDeps | null {
	try {
		return { storage: window.sessionStorage, reload: () => window.location.reload(), now: Date.now() };
	} catch {
		return null;
	}
}

/**
 * True when the error is a lost chunk and the page has not reloaded for one
 * in the last {@link AGAIN_MS}, so a reload is worth trying. It only reads.
 */
export function reloadDue(error: unknown, deps: ReloadDeps | null = browserDeps()): boolean {
	if (!deps || !isChunkError(error)) return false;

	try {
		const last = Number(deps.storage.getItem(RELOADED_KEY));

		return !last || deps.now - last >= AGAIN_MS;
	} catch {
		return false;
	}
}

/**
 * Reloads the page once for a lost chunk, which a fresh page loads again. A
 * second loss within {@link AGAIN_MS} of that reload does not reload again, so
 * a broken build never loops. Returns true when it reloaded.
 */
export function reloadForChunk(error: unknown, deps: ReloadDeps | null = browserDeps()): boolean {
	if (!deps || !reloadDue(error, deps)) return false;

	try {
		deps.storage.setItem(RELOADED_KEY, String(deps.now));
	} catch {
		return false;
	}

	deps.reload();

	return true;
}
