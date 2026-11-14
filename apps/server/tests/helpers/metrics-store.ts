import { afterEach, beforeEach } from 'bun:test';
import { useTempStore } from './temp-store';

/** A chat request whose key and prompt must never reach stored metrics or telemetry. */
export const CHAT_OPTIONS = {
	baseUrl: 'https://model.test/v1',
	apiKey: 'secret-not-for-metrics',
	model: 'model-a',
	messages: [{ role: 'user' as const, content: 'private prompt' }]
};

/** The usage the stubbed endpoint reports for every call. */
export const COMPLETION_USAGE = {
	prompt_tokens: 100,
	completion_tokens: 30,
	total_tokens: 130,
	prompt_tokens_details: { cached_tokens: 40, cache_write_tokens: 10 },
	completion_tokens_details: { reasoning_tokens: 20 }
};

/**
 * Gives the test file its own store (see {@link useTempStore}) and a model endpoint that answers `ok` with
 * {@link COMPLETION_USAGE}; fetch is stubbed before each test and restored after it.
 */
export function useMetricsStore(prefix: string): void {
	const originalFetch = globalThis.fetch;

	useTempStore(prefix);

	beforeEach(() => {
		globalThis.fetch = (async () =>
			Response.json({ choices: [{ message: { content: 'ok' } }], usage: COMPLETION_USAGE })) as unknown as typeof fetch;
	});

	afterEach(() => {
		globalThis.fetch = originalFetch;
	});
}
