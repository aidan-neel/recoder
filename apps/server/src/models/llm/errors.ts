import type { ChatOptions } from './types';

export class LlmError extends Error {
	status: number;

	constructor(status: number, message: string) {
		super(message);
		this.status = status;
	}
}

/** Any failure as an LlmError, so routes answer it with the model-failure shape. */
export function asLlmError(err: unknown): LlmError {
	if (err instanceof LlmError) return err;

	return new LlmError(0, err instanceof Error ? err.message : String(err));
}

const TRANSIENT_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

const TRANSIENT_NETWORK =
	/stalled|socket|ECONNRESET|ECONNREFUSED|EPIPE|ETIMEDOUT|EAI_AGAIN|fetch failed|network|connection (?:was )?(?:closed|reset|refused|lost)|other side closed|Unable to connect|terminated/i;

/** ChatGPT's own wording for a dropped or cut-short response stream. */
const CODEX_TRANSIENT = /response failed|incomplete response|could not complete/i;

/**
/** A provider's wording for a request throttle that lifts within a minute. */
const THROTTLE = /rate limit|too many requests/i;

/** Wording that means the plan or quota is spent, even when the provider also calls it a rate limit. */
const SPENT_PLAN = /quota|usage|insufficient|balance|billing|credit|exhausted|reset at|per (?:day|week|month)/i;

/**
 * A 429 from OpenCode that says the provider is throttling requests, not that
 * the plan is spent. OpenCode retries most rate limits itself but passes some
 * straight through (Z.AI's "Rate limit reached for requests"), so Recoder
 * retries these instead of stopping the review as out of usage.
 */
export function isOpenCodeThrottle(err: LlmError): boolean {
	return err.status === 429 && THROTTLE.test(err.message) && !SPENT_PLAN.test(err.message);
}

/**
 * Dropped sockets and overloaded servers (vLLM restarts, proxies) are worth another try; bad requests are not.
 * ChatGPT's 429 is a usage cap that lasts hours, not a momentary rate limit, so it never retries.
 * OpenCode's 429 is a spent plan unless its wording says it is a throttle.
 */
export function isTransientLlmError(err: unknown, provider?: ChatOptions['provider']): boolean {
	if (!(err instanceof LlmError)) return false;
	if (provider === 'codex' && err.status === 429) return false;
	if (provider === 'opencode' && err.status === 429) return isOpenCodeThrottle(err);
	if (TRANSIENT_STATUS.has(err.status)) return true;
	if (err.status !== 0 || /cancelled|timed out|truncated/i.test(err.message)) return false;

	return TRANSIENT_NETWORK.test(err.message) || (provider === 'codex' && CODEX_TRANSIENT.test(err.message));
}

/**
 * The provider is shedding load (HTTP 429, 529 or "overloaded"), so the limiter should send fewer calls at once.
 * A 429 from ChatGPT or OpenCode is not that signal: ChatGPT's is a usage cap that lasts hours, and OpenCode
 * retries rate limits itself, so its 429 means a spent plan. Easing off would only slow every other model's calls.
 */
export function isRateLimitError(err: unknown, provider?: ChatOptions['provider']): boolean {
	if (!(err instanceof LlmError)) return false;
	if ((provider === 'codex' || provider === 'opencode') && err.status === 429) return false;

	return err.status === 429 || err.status === 529 || /overloaded/i.test(err.message);
}

/**
 * No concurrency slot freed up in time, so the model never saw the call. It is
 * not a slow model: retrying or telling it to think less would not help.
 */
export class CapacityError extends LlmError {
	constructor() {
		super(0, 'No model capacity freed up in time');
	}
}

/** The error every layer throws when the caller's signal aborts. */
export function cancelledError(): LlmError {
	return new LlmError(0, 'Model request cancelled');
}

/** The error for a call that used up its whole `timeoutMs` budget. */
export function timedOutError(timeoutMs: number): LlmError {
	return new LlmError(0, `Model request timed out after ${Math.round(timeoutMs / 1000)}s`);
}
