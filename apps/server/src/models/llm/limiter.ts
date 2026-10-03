import { CapacityError, cancelledError } from './errors';

/**
 * Global cap shared by review assignments and interactive discussions, so the
 * model endpoint is never overwhelmed. Tune with RECODER_LLM_CONCURRENCY
 * (default 8, enough for every reviewer at once). A slot is acquired only
 * when a concrete call is ready, never as hundreds of pre-created waiters.
 */
let llmActive = 0;

const llmWaiters: (() => void)[] = [];

function llmLimit(): number {
	const raw = Number(process.env.RECODER_LLM_CONCURRENCY);

	return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 8;
}

export async function acquireLlmSlot(signal?: AbortSignal, timeoutMs = 120_000): Promise<void> {
	if (signal?.aborted) throw cancelledError();

	if (llmActive < llmLimit()) {
		llmActive++;

		return;
	}

	await new Promise<void>((resolve, reject) => {
		const cleanup = () => {
			clearTimeout(timer);
			signal?.removeEventListener('abort', abort);
		};

		const grant = () => {
			cleanup();
			resolve();
		};

		const fail = (error: Error) => {
			const index = llmWaiters.indexOf(grant);

			if (index < 0) return;
			llmWaiters.splice(index, 1);
			cleanup();
			reject(error);
		};

		const abort = () => fail(cancelledError());
		const timer = setTimeout(() => fail(new CapacityError()), timeoutMs);

		llmWaiters.push(grant);
		signal?.addEventListener('abort', abort, { once: true });
	});
}

/** Hands the occupied slot straight to the next waiter, so new callers cannot steal it. */
export function releaseLlmSlot(): void {
	const next = llmWaiters.shift();

	if (next) next();
	else llmActive--;
}

/** Test helper: reset the limiter between tests. */
export function resetLlmLimiter(): void {
	llmActive = 0;
	llmWaiters.length = 0;
}
