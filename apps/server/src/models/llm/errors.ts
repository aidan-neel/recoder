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
 * Dropped sockets and overloaded servers (vLLM restarts, proxies) are worth another try; bad requests are not.
 * ChatGPT's 429 is a usage cap that lasts hours, not a momentary rate limit, so it never retries.
 */
export function isTransientLlmError(err: unknown, provider?: ChatOptions['provider']): boolean {
	if (!(err instanceof LlmError)) return false;
	if (provider === 'codex' && err.status === 429) return false;
	if (TRANSIENT_STATUS.has(err.status)) return true;
	if (err.status !== 0 || /cancelled|timed out|truncated/i.test(err.message)) return false;

	return TRANSIENT_NETWORK.test(err.message) || (provider === 'codex' && CODEX_TRANSIENT.test(err.message));
}

/** The error every layer throws when the caller's signal aborts. */
export function cancelledError(): LlmError {
	return new LlmError(0, 'Model request cancelled');
}

/** The error for a call that used up its whole `timeoutMs` budget. */
export function timedOutError(timeoutMs: number): LlmError {
	return new LlmError(0, `Model request timed out after ${Math.round(timeoutMs / 1000)}s`);
}
