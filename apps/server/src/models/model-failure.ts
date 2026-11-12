import type { ModelFailure, UsageLimit } from '@recoder/shared';
import { LlmError } from './llm.js';
import { statesPlanSpent, UsageLimitError } from './llm/errors.js';
import { hostedProvider } from './model-providers.js';
import type { ModelConfig } from './models.js';
import { agentById } from '../agents/registry.js';
import { outOfUsage } from './out-of-usage.js';

type ModelRef = Pick<ModelConfig, 'provider' | 'source'> | undefined;

/** The provider rejected the key or token, so retrying cannot help. */
export function isAuthFailure(err: unknown): boolean {
	const status =
		typeof err === 'object' && err !== null && 'status' in err ? Number((err as { status: number }).status) : 0;

	if (status === 401 || status === 403) return true;

	const message = err instanceof Error ? err.message : String(err);

	return /\b401\b|\b403\b|unauthorized|forbidden|invalid api key|invalid token/i.test(message);
}

/**
 * The plan behind the model ran out: an agent CLI says so with a {@link UsageLimitError}, and a 402, a 429 that
 * outlasted every retry, or an error whose words say the plan is spent means a hosted plan or credit balance is
 * spent. Your own server has no plan: its 429 is an overload, reported as a plain failure. Short rate limits are
 * retried in `llm.ts` before this is reached.
 */
export function isUsageLimit(err: unknown, config: ModelRef): boolean {
	if (!(err instanceof LlmError)) return false;
	if (err instanceof UsageLimitError) return true;
	if (agentById(config?.provider) || !hostedProvider(config?.source)) return false;

	return err.status === 402 || err.status === 429 || statesPlanSpent(err.message);
}

function usageLimitFor(config: ModelRef): UsageLimit {
	const hosted = hostedProvider(config?.source);

	return { provider: hosted?.id ?? 'custom', name: hosted?.name ?? 'Your server', usageUrl: hosted?.usageUrl ?? null };
}

/**
 * Turn a failed model call into words for the developer. An agent CLI words its own failures (its messages are
 * written for people, and a limit message carries its reset time); raw endpoint errors (`LLM 401: {…}`) are
 * replaced so response bodies never reach the UI.
 */
export function modelFailure(err: unknown, config: ModelRef, fallback: string): ModelFailure {
	const agent = agentById(config?.provider);

	if (agent && err instanceof LlmError) return agent.describeFailure(err, fallback, config?.source);

	if (isUsageLimit(err, config)) return outOfUsage(usageLimitFor(config));

	if (isAuthFailure(err)) {
		const hosted = hostedProvider(config?.source);

		return {
			reason: hosted
				? `${hosted.name} rejected the API key. Reconnect it in Settings → Agent.`
				: 'The model endpoint rejected the API key. Pick another model in Settings → Agent.'
		};
	}

	if (err instanceof LlmError && err.message && !/^LLM\b/.test(err.message)) return { reason: err.message };

	return { reason: fallback };
}
