/** One read the early fetch script started while the page was still parsing. */
interface EarlyRead {
	/** When it started, in epoch ms. */
	at: number;
	response: Promise<Response>;
}

declare global {
	interface Window {
		/** The reads `EARLY_FETCH_SCRIPT` started, by API path; each is taken once. */
		__recoderEarly?: Record<string, EarlyRead>;
	}
}

/** How long an early read stays usable. It only stands in for the first load; anything later reads afresh. */
const FRESH_MS = 10_000;

/**
 * The read the early fetch script started for `path`, if it started one in
 * the last few seconds. It is handed out once, so a later call to the same
 * path, such as a refresh, always asks the server again.
 */
export function takeEarly(path: string): Promise<Response> | undefined {
	if (typeof window === 'undefined') return undefined;

	const reads = window.__recoderEarly;
	const read = reads?.[path];

	if (!reads || !read) return undefined;

	delete reads[path];

	return Date.now() - read.at < FRESH_MS ? read.response : undefined;
}
