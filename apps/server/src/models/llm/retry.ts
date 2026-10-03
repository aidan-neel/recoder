import { cancelledError, isTransientLlmError, timedOutError } from './errors';
import type { ChatOptions } from './types';

function llmRetries(): number {
	const raw = Number(process.env.RECODER_LLM_RETRIES);

	return Number.isFinite(raw) && raw >= 0 ? Math.floor(raw) : 5;
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
	return new Promise((resolve, reject) => {
		if (signal?.aborted) return reject(cancelledError());

		const timer = setTimeout(() => {
			signal?.removeEventListener('abort', onAbort);
			resolve();
		}, ms);

		const onAbort = () => {
			clearTimeout(timer);
			reject(cancelledError());
		};

		signal?.addEventListener('abort', onAbort, { once: true });
	});
}

/**
 * Run one model request, retrying transient failures with backoff (1s, 2s, 4s…
 * capped at 15s) while the request's deadline allows. `canRetry` lets streaming
 * callers stop once text has reached the user.
 */
export async function withRetries<T>(
	opts: Pick<ChatOptions, 'signal' | 'timeoutMs' | 'provider'>,
	deadline: number,
	attempt: (timeoutMs: number) => Promise<T>,
	canRetry: () => boolean = () => true
): Promise<T> {
	const max = llmRetries();

	for (let tries = 0; ; tries++) {
		try {
			return await attempt(Math.max(1, deadline - Date.now()));
		} catch (err) {
			const wait = Math.min(15_000, 1_000 * 2 ** tries);

			if (
				opts.signal?.aborted ||
				tries >= max ||
				!isTransientLlmError(err, opts.provider) ||
				!canRetry() ||
				Date.now() + wait >= deadline - 5_000
			)
				throw err;
			console.warn(`[llm] ${(err as Error).message} — retrying in ${wait / 1000}s (${tries + 1}/${max})`);
			await sleep(wait, opts.signal);
		}
	}
}

/**
 * Settle at the deadline (or on cancel) no matter what `work` is stuck on.
 * Every layer below aborts its own fetch, but a socket can wedge somewhere an
 * abort doesn't reach; without this a review waits on that call forever and
 * the model slot it holds is never given back. The backstop fires a little
 * after the deadline so the request can report its own timeout or stall first.
 */
export function withHardDeadline<T>(
	work: Promise<T>,
	deadline: number,
	timeoutMs: number,
	signal?: AbortSignal
): Promise<T> {
	work.catch(() => {});

	let timer: ReturnType<typeof setTimeout> | undefined;
	let onAbort: (() => void) | undefined;

	const backstop = new Promise<never>((_, reject) => {
		const grace = Math.min(5_000, Math.max(250, timeoutMs / 10));

		timer = setTimeout(() => reject(timedOutError(timeoutMs)), Math.max(0, deadline - Date.now()) + grace);

		onAbort = () => reject(cancelledError());
		if (signal?.aborted) onAbort();
		else signal?.addEventListener('abort', onAbort, { once: true });
	});

	return Promise.race([work, backstop]).finally(() => {
		clearTimeout(timer);
		if (onAbort) signal?.removeEventListener('abort', onAbort);
	});
}

/**
 * One call's lifetime. Its signal aborts with the caller's or once the call
 * settles, so retries and the thinking fallback stop, and `live` drops
 * callbacks from work that outlived the call (a transport that ignored abort).
 */
export function requestScope(signal?: AbortSignal) {
	const settled = new AbortController();
	const scoped = signal ? AbortSignal.any([signal, settled.signal]) : settled.signal;

	const live =
		<A extends unknown[]>(fn: (...args: A) => void) =>
		(...args: A) => {
			if (!scoped.aborted) fn(...args);
		};

	return { signal: scoped, live, end: () => settled.abort() };
}

export type RequestScope = ReturnType<typeof requestScope>;
