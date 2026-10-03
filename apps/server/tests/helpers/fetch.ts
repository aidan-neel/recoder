/** A `fetch` stub that never answers and rejects once the request is aborted, for testing stop and cancel. */
export const fetchUntilAborted = (async (_url, init) => {
	await new Promise((_resolve, reject) =>
		init?.signal?.addEventListener('abort', () => reject(new Error('cancelled')), { once: true })
	);

	return new Response();
}) as typeof fetch;
