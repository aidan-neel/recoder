interface Entry<T> {
	value?: { data: T; at: number };
	pending?: Promise<T>;
}

/** A stale-while-revalidate cache: one load in flight per key, the last good value served while it runs. */
export interface Swr<T> {
	/**
	 * The stored value when there is one, with one background refresh once it
	 * is older than `staleMs`; a failed refresh keeps the old value. With no
	 * value yet, or one older than `expireMs`, the load in flight.
	 */
	read(key?: string): T | Promise<T>;
	/** A value loaded now, shared with any load already in flight. */
	fresh(key?: string): Promise<T>;
	/** Forgets every stored value, so the next read loads again. */
	clear(): void;
}

export function swr<T>(staleMs: number, load: (key: string) => Promise<T>, expireMs = Infinity): Swr<T> {
	const entries = new Map<string, Entry<T>>();

	function entryFor(key: string): Entry<T> {
		let entry = entries.get(key);

		if (!entry) {
			entry = {};
			entries.set(key, entry);
		}

		return entry;
	}

	function refresh(key: string, entry: Entry<T>): Promise<T> {
		entry.pending ??= load(key)
			.then((data) => {
				if (entries.get(key) === entry) entry.value = { data, at: Date.now() };

				return data;
			})
			.finally(() => {
				entry.pending = undefined;
			});

		return entry.pending;
	}

	return {
		read(key = '') {
			const entry = entryFor(key);

			const age = entry.value ? Date.now() - entry.value.at : Infinity;

			if (!entry.value || age > expireMs) return refresh(key, entry);

			if (age > staleMs) refresh(key, entry).catch(() => undefined);

			return entry.value.data;
		},
		fresh(key = '') {
			return refresh(key, entryFor(key));
		},
		clear() {
			entries.clear();
		}
	};
}
