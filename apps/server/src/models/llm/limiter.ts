import { CapacityError, cancelledError } from './errors';

const DEFAULT_CEILING = 64;

const BACKOFF_FLOOR = 4;

const BACKOFF_COOLDOWN_MS = 10_000;

interface EndpointState {
	active: number;
	backedOffLimit: number;
	lastCutAt: number;
	waiters: (() => void)[];
}

/**
 * Concurrency cap kept per model endpoint, shared by review assignments and
 * interactive discussions, so no endpoint is overwhelmed and one provider's
 * trouble never slows another. RECODER_LLM_CONCURRENCY sets each endpoint's
 * ceiling (default 64, so a score of reviews can run at once). Below the ceiling
 * sits an effective limit that backs off when that endpoint pushes back: a rate
 * limit halves it down to a floor of 4, at most once per cooldown so a burst of
 * rejected calls counts as one signal, and after the cooldown every success on
 * the endpoint gives back one slot. Lowering it never revokes a held slot; it
 * only stops new grants until the active count falls under it. A slot is
 * acquired only when a concrete call is ready, never as hundreds of pre-created
 * waiters.
 */
const endpoints = new Map<string, EndpointState>();

function stateOf(endpoint: string): EndpointState {
	let state = endpoints.get(endpoint);

	if (!state) {
		state = { active: 0, backedOffLimit: Infinity, lastCutAt: -Infinity, waiters: [] };
		endpoints.set(endpoint, state);
	}

	return state;
}

/**
 * The key a call's limiter state lives under: its base URL without trailing
 * slashes and with a lowercase host, or the provider name for transports that
 * have no base URL (codex, opencode).
 */
export function llmEndpoint(target: { baseUrl?: string; provider?: string }): string {
	const trimmed = (target.baseUrl ?? '').trim().replace(/\/+$/, '');

	if (!trimmed) return target.provider ?? 'openai-compatible';

	try {
		const url = new URL(trimmed);

		return `${url.protocol}//${url.host}${url.pathname}`.replace(/\/+$/, '');
	} catch {
		return trimmed;
	}
}

function llmCeiling(): number {
	const raw = Number(process.env.RECODER_LLM_CONCURRENCY);

	return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : DEFAULT_CEILING;
}

function llmLimit(state: EndpointState): number {
	return Math.min(state.backedOffLimit, llmCeiling());
}

/** Hands free slots to waiters in arrival order while the limit allows. */
function grantWaiters(state: EndpointState): void {
	while (state.waiters.length && state.active < llmLimit(state)) {
		state.active++;
		state.waiters.shift()?.();
	}
}

/** A call that reached the model and finished: once the cooldown is over, give back one slot of the endpoint's limit. */
export function recordLlmSuccess(endpoint: string): void {
	const state = stateOf(endpoint);

	if (state.backedOffLimit === Infinity || Date.now() - state.lastCutAt < BACKOFF_COOLDOWN_MS) return;

	const limit = llmLimit(state);

	state.backedOffLimit = limit + 1 >= llmCeiling() ? Infinity : limit + 1;
	grantWaiters(state);
}

/** The endpoint rate-limited a call, so halve its limit (never below the floor or the ceiling itself), once per cooldown. */
export function recordLlmRateLimit(endpoint: string): void {
	const state = stateOf(endpoint);
	const now = Date.now();

	if (now - state.lastCutAt < BACKOFF_COOLDOWN_MS) return;

	state.lastCutAt = now;
	state.backedOffLimit = Math.max(Math.min(BACKOFF_FLOOR, llmCeiling()), Math.floor(llmLimit(state) / 2));
}

export async function acquireLlmSlot(endpoint: string, signal?: AbortSignal, timeoutMs = 120_000): Promise<void> {
	if (signal?.aborted) throw cancelledError();

	const state = stateOf(endpoint);

	if (state.active < llmLimit(state)) {
		state.active++;

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
			const index = state.waiters.indexOf(grant);

			if (index < 0) return;
			state.waiters.splice(index, 1);
			cleanup();
			reject(error);
		};

		const abort = () => fail(cancelledError());
		const timer = setTimeout(() => fail(new CapacityError()), timeoutMs);

		state.waiters.push(grant);
		signal?.addEventListener('abort', abort, { once: true });
	});
}

/** Frees a slot on the endpoint and gives it to the next waiter there at once, so new callers cannot steal it. */
export function releaseLlmSlot(endpoint: string): void {
	const state = stateOf(endpoint);

	state.active--;
	grantWaiters(state);
}

/** Test helper: reset the limiter between tests. */
export function resetLlmLimiter(): void {
	endpoints.clear();
}
