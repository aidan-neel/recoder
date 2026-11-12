/** Runs work queued under one key. */
export type KeyedQueue = <T>(key: string, work: () => Promise<T>) => Promise<T>;

/**
 * A queue per key: work under one key runs one call at a time, in the order
 * it was queued, while work under other keys runs freely. A failed call
 * answers its own caller only; the next call under the key still runs.
 */
export function keyedQueue(): KeyedQueue {
	const tails = new Map<string, Promise<void>>();

	return <T>(key: string, work: () => Promise<T>): Promise<T> => {
		const run = (tails.get(key) ?? Promise.resolve()).then(work);

		const settled = run.then(
			() => undefined,
			() => undefined
		);

		tails.set(key, settled);

		void settled.then(() => {
			if (tails.get(key) === settled) tails.delete(key);
		});

		return run;
	};
}
