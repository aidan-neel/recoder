import { AsyncLocalStorage } from 'node:async_hooks';
import { CapacityError, cancelledError } from './errors';

/**
 * Who a model request waits for a slot on behalf of, usually one review. When
 * an endpoint is full the limiter takes turns between lanes, so one busy review
 * cannot hold back another.
 */
export interface LlmLane {
	id: string;
	/** Told how long each request in the lane waited for its slot, 0 when one was free. Runs while the slot is held, so it must not throw. */
	recordWait: (waitedMs: number) => void;
}

const DEFAULT_CEILING = 64;

/**
 * Endpoints whose every call starts a local process get a small ceiling of their own, read from an env var:
 * Claude Code (default 8) and Devin (default 4) run one CLI per call, so `RECODER_CLAUDE_CODE_CONCURRENCY` and
 * `RECODER_DEVIN_CONCURRENCY` cap them, never above the shared ceiling.
 */
const PROCESS_CEILINGS: Record<string, { env: string; fallback: number }> = {
	'claude-code': { env: 'RECODER_CLAUDE_CODE_CONCURRENCY', fallback: 8 },
	devin: { env: 'RECODER_DEVIN_CONCURRENCY', fallback: 4 }
};

const BACKOFF_FLOOR = 4;

const BACKOFF_COOLDOWN_MS = 10_000;

/** The lane of requests made outside any review: home brief, settings checks. */
const SHARED_LANE: LlmLane = { id: '', recordWait: () => undefined };

const lanes = new AsyncLocalStorage<LlmLane>();

interface EndpointState {
	endpoint: string;
	active: number;
	backedOffLimit: number;
	lastCutAt: number;
	/** Waiting requests per lane id, each in arrival order. */
	waiting: Map<string, (() => void)[]>;
	/** Lane ids with waiting requests, in the order they take their next turn. */
	turns: string[];
}

/**
 * Concurrency cap kept per model endpoint, shared by review assignments and
 * interactive discussions, so no endpoint is overwhelmed and one provider's
 * trouble never slows another. RECODER_LLM_CONCURRENCY sets each endpoint's
 * ceiling (default 64, so a score of reviews can run at once); Claude Code's
 * endpoint is capped lower, see {@link PROCESS_CEILINGS}. Below the ceiling
 * sits an effective limit that backs off when that endpoint pushes back: a rate
 * limit halves it down to a floor of 4, at most once per cooldown so a burst of
 * rejected calls counts as one signal, and after the cooldown every success on
 * the endpoint gives back one slot. Lowering it never revokes a held slot; it
 * only stops new grants until the active count falls under it. A slot is
 * acquired only when a concrete call is ready, never as hundreds of pre-created
 * waiters. Freed slots go round-robin across the lanes that wait (see
 * {@link withLlmLane}), in arrival order within a lane.
 */
const endpoints = new Map<string, EndpointState>();

function stateOf(endpoint: string): EndpointState {
	let state = endpoints.get(endpoint);

	if (!state) {
		state = {
			endpoint,
			active: 0,
			backedOffLimit: Infinity,
			lastCutAt: -Infinity,
			waiting: new Map(),
			turns: []
		};

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

/** A positive whole count from the environment, or the fallback. */
function envCount(name: string, fallback: number): number {
	const raw = Number(process.env[name]);

	return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : fallback;
}

function llmCeiling(endpoint: string): number {
	const shared = envCount('RECODER_LLM_CONCURRENCY', DEFAULT_CEILING);
	const own = PROCESS_CEILINGS[endpoint];

	return own ? Math.min(shared, envCount(own.env, own.fallback)) : shared;
}

function llmLimit(state: EndpointState): number {
	return Math.min(state.backedOffLimit, llmCeiling(state.endpoint));
}

/** Model requests `run` makes, however nested, wait for slots in `lane`'s turn. */
export function withLlmLane<T>(lane: LlmLane, run: () => T): T {
	return lanes.run(lane, run);
}

/** Takes the next lane's oldest waiter off the queue; the lane goes to the back of the turns while it has more. */
function takeNextWaiter(state: EndpointState): (() => void) | undefined {
	const lane = state.turns.shift();

	if (lane === undefined) return undefined;

	const queue = state.waiting.get(lane) ?? [];
	const grant = queue.shift();

	if (queue.length) state.turns.push(lane);
	else state.waiting.delete(lane);

	return grant;
}

/** Hands free slots to waiters, one lane at a time, while the limit allows. */
function grantWaiters(state: EndpointState): void {
	while (state.turns.length && state.active < llmLimit(state)) {
		const grant = takeNextWaiter(state);

		if (!grant) continue;
		state.active++;
		grant();
	}
}

/** Joins the back of `lane`'s queue; a lane that had nobody waiting takes the last turn. */
function enqueueWaiter(state: EndpointState, lane: string, grant: () => void): void {
	const queue = state.waiting.get(lane);

	if (queue) {
		queue.push(grant);

		return;
	}

	state.waiting.set(lane, [grant]);
	state.turns.push(lane);
}

/** Takes a waiter that gave up out of its lane, and the lane out of the turns once it is empty; false when it was already granted. */
function removeWaiter(state: EndpointState, lane: string, grant: () => void): boolean {
	const queue = state.waiting.get(lane);
	const index = queue?.indexOf(grant) ?? -1;

	if (!queue || index < 0) return false;

	queue.splice(index, 1);

	if (!queue.length) {
		state.waiting.delete(lane);
		state.turns.splice(state.turns.indexOf(lane), 1);
	}

	return true;
}

/** A call that reached the model and finished: once the cooldown is over, give back one slot of the endpoint's limit. */
export function recordLlmSuccess(endpoint: string): void {
	const state = stateOf(endpoint);

	if (state.backedOffLimit === Infinity || Date.now() - state.lastCutAt < BACKOFF_COOLDOWN_MS) return;

	const limit = llmLimit(state);

	state.backedOffLimit = limit + 1 >= llmCeiling(endpoint) ? Infinity : limit + 1;
	grantWaiters(state);
}

/** The endpoint rate-limited a call, so halve its limit (never below the floor or the ceiling itself), once per cooldown. */
export function recordLlmRateLimit(endpoint: string): void {
	const state = stateOf(endpoint);
	const now = Date.now();

	if (now - state.lastCutAt < BACKOFF_COOLDOWN_MS) return;

	state.lastCutAt = now;
	state.backedOffLimit = Math.max(Math.min(BACKOFF_FLOOR, llmCeiling(endpoint)), Math.floor(llmLimit(state) / 2));
}

/**
 * Waits for a slot on the endpoint in the current lane's turn and tells the
 * lane how long it waited. A request still waiting after `timeoutMs` fails with
 * a {@link CapacityError}, so running out of capacity never reads as a model
 * failure; an aborted signal fails it as cancelled.
 */
export async function acquireLlmSlot(endpoint: string, signal?: AbortSignal, timeoutMs = 120_000): Promise<void> {
	if (signal?.aborted) throw cancelledError();

	const state = stateOf(endpoint);
	const lane = lanes.getStore() ?? SHARED_LANE;

	if (!state.turns.length && state.active < llmLimit(state)) {
		state.active++;
		lane.recordWait(0);

		return;
	}

	const queuedAt = Date.now();

	await waitForTurn(state, lane.id, signal, timeoutMs);
	lane.recordWait(Date.now() - queuedAt);
}

/** Queues the request in its lane until it is granted a slot, its timeout passes or its signal aborts. */
function waitForTurn(
	state: EndpointState,
	lane: string,
	signal: AbortSignal | undefined,
	timeoutMs: number
): Promise<void> {
	return new Promise<void>((resolve, reject) => {
		const cleanup = () => {
			clearTimeout(timer);
			signal?.removeEventListener('abort', abort);
		};

		const grant = () => {
			cleanup();
			resolve();
		};

		const fail = (error: Error) => {
			if (!removeWaiter(state, lane, grant)) return;
			cleanup();
			reject(error);
		};

		const abort = () => fail(cancelledError());
		const timer = setTimeout(() => fail(new CapacityError()), timeoutMs);

		enqueueWaiter(state, lane, grant);
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
