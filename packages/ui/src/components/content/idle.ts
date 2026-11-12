/**
 * Runs `run` once the page is idle, and after `waitMs` at the latest; where
 * the browser has no idle callback (Safari), after `waitMs`. Returns the
 * cancel.
 */
export function whenIdle(run: () => void, waitMs: number): () => void {
	if (typeof requestIdleCallback === 'function') {
		const handle = requestIdleCallback(run, { timeout: waitMs });

		return () => cancelIdleCallback(handle);
	}

	const timer = setTimeout(run, waitMs);

	return () => clearTimeout(timer);
}
