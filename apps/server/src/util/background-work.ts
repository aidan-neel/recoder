/** Work that outlives the request that started it, such as a rule ledger distilled for the next review. */
const pending = new Set<Promise<unknown>>();

/** Tracks `work` until it settles, so a process about to exit can let it finish. */
export function trackBackgroundWork(work: Promise<unknown>): void {
	const tracked = work.then(
		() => undefined,
		() => undefined
	);

	pending.add(tracked);
	void tracked.finally(() => pending.delete(tracked));
}

/**
 * Resolves once every piece of work tracked so far has settled. Kept free of imports, so the CLI's entry can wait on
 * it without loading the review modules first.
 */
export async function settleBackgroundWork(): Promise<void> {
	await Promise.all(pending);
}
