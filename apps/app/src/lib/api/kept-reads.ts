/** Reads by id that share one request while it is in flight and keep the last answer, so a screen paints it at once. */
export interface KeptReads<Value> {
	/** The value as this app last saw it, or null before its first read. */
	peek(id: string): Value | null;
	/** Reads the value, sharing one request across callers; the answer is kept for `peek`. */
	read(id: string): Promise<Value>;
	/** Starts the read, so the screen that opens it finds it partway or done. */
	warm(id: string): void;
	/** The newest copy something else delivered, such as a stream; `peek` shows it. */
	keep(id: string, value: Value): void;
	/** Forgets the value: deleted, or a read that found it gone. */
	forget(id: string): void;
}

/** Keeps what `load` answers per id. */
export function keptReads<Value>(load: (id: string) => Promise<Value>): KeptReads<Value> {
	const held = new Map<string, Value>();
	const inflight = new Map<string, Promise<Value>>();

	function read(id: string): Promise<Value> {
		const pending = inflight.get(id);

		if (pending) return pending;

		const promise = load(id)
			.then((value) => {
				held.set(id, value);

				return value;
			})
			.finally(() => {
				if (inflight.get(id) === promise) inflight.delete(id);
			});

		inflight.set(id, promise);

		return promise;
	}

	return {
		peek: (id) => held.get(id) ?? null,
		read,

		warm(id) {
			void read(id).catch(() => undefined);
		},

		keep(id, value) {
			held.set(id, value);
		},

		forget(id) {
			held.delete(id);
		}
	};
}
