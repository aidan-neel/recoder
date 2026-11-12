/**
 * Warms the dev server's main pages once it is up. Turbopack compiles a
 * route on its first request, which after a fresh `bun run dev` took 12s for
 * the queue and 8s for settings, so this asks for each one in the background
 * and the first real visit finds it compiled. It prints nothing, and it gives
 * up quietly when the server never answers, or once the shell that started
 * `next dev` and this script has gone.
 */

const port = process.argv[2] ?? '5180';

const base = `http://localhost:${port}`;

/** The queue compiles the shell every page shares, so it goes first, alone. */
const FIRST = '/';

/** Then a review, settings and the sample queue, together. */
const THEN = ['/review/sample', '/settings/agent', '/sample'];

/** How long to keep looking for the server while it starts. */
const START_WAIT_MS = 120_000;

/** How often to look meanwhile. */
const POLL_MS = 500;

/** The longest one page may take, compile included. */
const PAGE_WAIT_MS = 120_000;

/** The shell that started `next dev` and this script; when it exits, this one is handed to another parent. */
const parent = process.ppid;

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Asks for a page and reads it through, so its render finishes. False when
 * the server can't be reached. The `warm` query marks the request, so the
 * dev server's request log can leave it out.
 */
async function visit(path: string): Promise<boolean> {
	try {
		const response = await fetch(`${base}${path}?warm`, { signal: AbortSignal.timeout(PAGE_WAIT_MS) });

		await response.arrayBuffer();

		return true;
	} catch {
		return false;
	}
}

/** Waits for the server to answer the queue, then warms the other pages. */
async function warm(): Promise<void> {
	const deadline = Date.now() + START_WAIT_MS;

	while (!(await visit(FIRST))) {
		if (Date.now() > deadline || process.ppid !== parent) return;

		await sleep(POLL_MS);
	}

	await Promise.all(THEN.map(visit));
}

await warm();
