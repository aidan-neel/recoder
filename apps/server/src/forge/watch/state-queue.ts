let pending: Promise<void> = Promise.resolve();

/** Keep each read/decide/start/write of the shared cursor file together across poller and webhook requests. */
export function withWatchState<T>(work: () => Promise<T>): Promise<T> {
	const result = pending.then(work);

	pending = result.then(
		() => undefined,
		() => undefined
	);

	return result;
}
