import { LlmError, UsageLimitError, isProviderThrottle } from '../../models/llm/errors';

/** Agent-facing failure with a message safe to show in the UI. */
export class OpenCodeError extends Error {
	constructor(
		message: string,
		readonly status = 502
	) {
		super(message);
		this.name = 'OpenCodeError';
	}
}

/**
 * A failure OpenCode reports, by the HTTP status the provider (or OpenCode) gave it. OpenCode retries rate limits
 * itself, so a 402, or a 429 whose words do not say the provider is only throttling, means the plan is spent.
 */
export function providerError(status: number, message: string): LlmError {
	const error = new LlmError(status, message);

	if (status === 402 || (status === 429 && !isProviderThrottle(error))) return new UsageLimitError(status, message);

	return error;
}
