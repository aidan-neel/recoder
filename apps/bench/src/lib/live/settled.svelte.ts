/** Load data that arrives as a plain value when the server had it cached, else as a streamed promise. */
export type Streamed<T> = T | Promise<T>;

function isPromise<T>(input: Streamed<T>): input is Promise<T> {
	return typeof (input as { then?: unknown } | null)?.then === 'function';
}

/**
 * The last value `source` handed over. Until the first one `current` is
 * undefined, which is when a page shows its skeleton; a later promise keeps
 * the old value on screen until it resolves, so a poll never brings the
 * skeleton back. When `key` changes the old value belongs to something else,
 * so it is dropped. `error` is set only when there is no value to show.
 */
export function settled<T>(
	source: () => Streamed<T>,
	key: () => string = () => ''
): { readonly current: T | undefined; readonly error: string | null } {
	const first = source();

	let current = $state.raw<T | undefined>(isPromise(first) ? undefined : first);
	let error = $state.raw<string | null>(null);
	let shown = key();

	$effect.pre(() => {
		const input = source();
		const next = key();

		if (next !== shown) {
			shown = next;
			current = undefined;
			error = null;
		}

		if (!isPromise(input)) {
			current = input;
			error = null;

			return;
		}

		let live = true;

		input.then(
			(value) => {
				if (!live) return;

				current = value;
				error = null;
			},
			(failure: unknown) => {
				if (live && current === undefined) error = (failure as { message?: string } | null)?.message ?? String(failure);
			}
		);

		return () => {
			live = false;
		};
	});

	return {
		get current() {
			return current;
		},
		get error() {
			return error;
		}
	};
}
