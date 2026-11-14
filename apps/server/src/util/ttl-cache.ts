/** Every cache, so `clearAllCaches` can reach them. */
const registry = new Set<TtlCache<unknown>>();

/** A stored load: its value and when it was stored, or the error it failed with when failures are kept. */
type Entry<T> =
	{ ok: true; value: T; expires: number; stored: number } | { ok: false; error: unknown; expires: number };

/**
 * Short-lived cache for slow provider lookups (CLI spawns, REST calls).
 * Concurrent callers for one key share a single load, and `clearAllCaches`
 * drops everything when credentials change. A failed load is not cached,
 * unless `failureMs` says how long to keep its error, so a forge that keeps
 * refusing is not asked again on every request. Past `max` keys, the one
 * read least recently goes first.
 */
export class TtlCache<T> {
	private entries = new Map<string, Entry<T>>();
	private inflight = new Map<string, Promise<T>>();

	constructor(
		private readonly ttlMs: number,
		private readonly max = 200,
		private readonly failureMs = 0
	) {
		registry.add(this as TtlCache<unknown>);
	}

	/** The cached value (or kept error), or `load`'s result once it settles. */
	get(key: string, load: () => Promise<T>): Promise<T> {
		const hit = this.read(key);

		if (hit && hit.expires > Date.now()) return hit.ok ? Promise.resolve(hit.value) : Promise.reject(hit.error);

		return this.load(key, load);
	}

	/**
	 * Stale-while-revalidate: any value this key has, at once, with a fresh
	 * load started in the background once it has expired. Only a key with no
	 * value yet (or only a kept error) waits for `load`. A value stored longer
	 * ago than `maxAgeMs` is too old to serve, so the caller joins the fresh
	 * load instead; unlimited when omitted.
	 */
	stale(key: string, load: () => Promise<T>, maxAgeMs = Number.POSITIVE_INFINITY): Promise<T> {
		const hit = this.read(key);

		if (!hit?.ok) return this.get(key, load);
		if (hit.expires > Date.now()) return Promise.resolve(hit.value);

		const fresh = this.load(key, load);

		if (Date.now() - hit.stored > maxAgeMs) return fresh;

		fresh.catch(() => undefined);

		return Promise.resolve(hit.value);
	}

	/** True while a load for this key is running. */
	loading(key: string): boolean {
		return this.inflight.has(key);
	}

	/** The key's entry, moved to the back of the eviction order, since it was just read. */
	private read(key: string): Entry<T> | undefined {
		const hit = this.entries.get(key);

		if (hit) {
			this.entries.delete(key);
			this.entries.set(key, hit);
		}

		return hit;
	}

	/**
	 * Runs `load`, joining one already in flight for this key. Its result is
	 * stored only while it is still this key's load: a clear, or a delete that
	 * covers the key, lets it go, since its result may predate a credential
	 * change, and the next read starts a fresh one. Other keys' loads go on.
	 */
	private load(key: string, load: () => Promise<T>): Promise<T> {
		const pending = this.inflight.get(key);

		if (pending) return pending;

		const current = () => this.inflight.get(key) === promise;

		const promise = load()
			.then(
				(value) => {
					if (current()) {
						this.store(key, { ok: true, value, expires: Date.now() + this.ttlMs, stored: Date.now() });
					}

					return value;
				},
				(error: unknown) => {
					if (this.failureMs > 0 && current()) {
						this.store(key, { ok: false, error, expires: Date.now() + this.failureMs });
					}

					throw error;
				}
			)
			.finally(() => {
				if (current()) this.inflight.delete(key);
			});

		this.inflight.set(key, promise);

		return promise;
	}

	private store(key: string, entry: Entry<T>): void {
		this.entries.delete(key);
		this.entries.set(key, entry);
		if (this.entries.size > this.max) this.entries.delete(this.entries.keys().next().value as string);
	}

	/** Drops every entry and load whose key starts with `prefix`; other keys keep theirs. */
	delete(prefix: string): void {
		for (const key of this.entries.keys()) if (key.startsWith(prefix)) this.entries.delete(key);
		for (const key of this.inflight.keys()) if (key.startsWith(prefix)) this.inflight.delete(key);
	}

	clear(): void {
		this.entries.clear();
		this.inflight.clear();
	}
}

export function clearAllCaches(): void {
	for (const cache of registry) cache.clear();
}
