import {
	CapacityError,
	isRateLimitError,
	LlmError,
	OutOfTimeError,
	TimedOutError,
	UsageLimitError
} from './llm/errors';

/** The error ended the call because its caller stopped it, not because the model or the transport did. */
export function isCancellation(err: unknown): boolean {
	if (!(err instanceof Error)) return false;
	if (err.name === 'AbortError' || err.name === 'ReviewAbortedError') return true;

	return err instanceof LlmError && err.status === 0 && /cancelled/i.test(err.message);
}

/** A one-word classification of a failed call's error, so the usage report can group them. */
export function errorKindOf(err: unknown): string {
	if (err instanceof UsageLimitError) return 'usage-limit';
	if (err instanceof CapacityError) return 'capacity';
	if (err instanceof TimedOutError) return 'timeout';
	if (err instanceof OutOfTimeError) return 'deadline';
	if (err instanceof Error && err.name === 'TimeoutError') return 'timeout';

	if (err instanceof LlmError) {
		if (isRateLimitError(err)) return 'rate-limit';
		if (err.status >= 500) return 'provider';
		if (err.status >= 400) return 'request';
	}

	return 'error';
}
