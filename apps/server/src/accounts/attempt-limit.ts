/** A sliding window: at most `limit` attempts per key in any `windowMs`. In memory, so each replica counts for itself. */
export class AttemptLimit {
	private readonly attempts = new Map<string, number[]>();

	constructor(
		private readonly limit: number,
		private readonly windowMs: number,
		private readonly now: () => number = () => Date.now()
	) {}

	/** Counts an attempt for `key` and says whether it is within the limit. A refused attempt is not counted. */
	allow(key: string): boolean {
		const now = this.now();
		const recent = (this.attempts.get(key) ?? []).filter((at) => at > now - this.windowMs);

		if (recent.length >= this.limit) {
			this.attempts.set(key, recent);

			return false;
		}

		this.attempts.set(key, [...recent, now]);

		return true;
	}
}
