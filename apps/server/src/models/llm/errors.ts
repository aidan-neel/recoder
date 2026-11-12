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

/** A provider's wording for a request throttle that lifts within a minute. */
const THROTTLE = /rate limit|too many requests/i;

/** Wording that means the plan or quota is spent, even when the provider also calls it a rate limit. */
const SPENT_PLAN = /quota|usage|insufficient|balance|billing|credit|exhausted|reset at|per (?:day|week|month)/i;

/**
 * The plan, quota or credit behind the model is spent, which lasts hours: it is never retried, never read as an
 * endpoint shedding load, and is reported as out of usage. An agent adapter raises it for its CLI's usage cap
 * (status 429) or spent credit (402), so nothing outside the adapter needs to know what a CLI's 429 means.
 */
export class UsageLimitError extends LlmError {}

/** The provider's words say the plan or quota is spent, so waiting minutes will not help. */
export function isSpentPlan(message: string): boolean {
	return SPENT_PLAN.test(message);
}

/**
 * A 429 whose words say the provider is throttling requests, not that the plan is spent. A router such as
 * OpenCode retries most rate limits itself but passes some straight through (Z.AI's "Rate limit reached for
 * requests"), so Recoder retries these, with a longer wait.
 */
export function isProviderThrottle(err: LlmError): boolean {
	return err.status === 429 && THROTTLE.test(err.message) && !isSpentPlan(err.message);
}

/**
 * Dropped sockets and overloaded servers (vLLM restarts, proxies) are worth another try; bad requests are not.
 * A spent plan never retries: an agent CLI raises {@link UsageLimitError} for it.
 */
export function isTransientLlmError(err: unknown): boolean {
	if (!(err instanceof LlmError) || err instanceof UsageLimitError) return false;
	if (TRANSIENT_STATUS.has(err.status)) return true;
	if (err.status !== 0 || /cancelled|timed out|truncated/i.test(err.message)) return false;

	return TRANSIENT_NETWORK.test(err.message);
}

/**
 * The provider is shedding load (HTTP 429, 529 or "overloaded"), so the limiter should send fewer calls at once.
 * A spent plan is not that signal (an agent CLI's {@link UsageLimitError}): it lasts hours, and easing off would
 * only slow every other model's calls.
 */
export function isRateLimitError(err: unknown): boolean {
	if (!(err instanceof LlmError) || err instanceof UsageLimitError) return false;

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
