/**
 * `work`'s result, or `fallback` once `ms` pass first. `work` goes on either
 * way; a caller that stops waiting still holds it for its later result.
 */
export function within<T, F = T>(work: Promise<T>, ms: number, fallback: F): Promise<T | F> {
	let timer: ReturnType<typeof setTimeout> | undefined;

	const late = new Promise<F>((resolve) => {
		timer = setTimeout(() => resolve(fallback), ms);
	});

	return Promise.race([work, late]).finally(() => clearTimeout(timer));
}
