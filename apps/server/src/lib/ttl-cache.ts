/**
 * Short-lived cache for slow provider lookups (CLI spawns, REST calls).
 * Concurrent callers for one key share a single load, a failed load is never
 * cached, and `clearAllCaches` drops everything when credentials change.
 */
const registry = new Set<TtlCache<unknown>>();

export class TtlCache<T> {
	private entries = new Map<string, { value: T; expires: number }>();
	private inflight = new Map<string, Promise<T>>();

	constructor(private readonly ttlMs: number, private readonly max = 200) {
		registry.add(this as TtlCache<unknown>);
	}

	get(key: string, load: () => Promise<T>): Promise<T> {
		const hit = this.entries.get(key);
		if (hit && hit.expires > Date.now()) return Promise.resolve(hit.value);
		const pending = this.inflight.get(key);
		if (pending) return pending;
		const generation = this.generation;
		const promise = load()
			.then((value) => {
				// A clear while loading means the value may predate a credential change.
				if (generation === this.generation) this.store(key, value);
				return value;
			})
			.finally(() => {
				if (this.inflight.get(key) === promise) this.inflight.delete(key);
			});
		this.inflight.set(key, promise);
		return promise;
	}

	private generation = 0;

	private store(key: string, value: T): void {
		this.entries.delete(key);
		this.entries.set(key, { value, expires: Date.now() + this.ttlMs });
		if (this.entries.size > this.max) this.entries.delete(this.entries.keys().next().value as string);
	}

	delete(prefix: string): void {
		for (const key of this.entries.keys()) if (key.startsWith(prefix)) this.entries.delete(key);
		this.generation++;
		this.inflight.clear();
	}

	clear(): void {
		this.entries.clear();
		this.inflight.clear();
		this.generation++;
	}
}

export function clearAllCaches(): void {
	for (const cache of registry) cache.clear();
}
