import type { ModelFailure, UsageLimit } from '@recoder/shared';
import { LlmError } from './llm.js';
import { hostedProvider } from './model-providers.js';
import type { RoleConfig } from './models.js';
import { isAuthFailure } from './planner.js';

type ModelRef = Pick<RoleConfig, 'provider' | 'source'> | undefined;

/**
 * The plan behind the model ran out: ChatGPT's 429 is its usage cap, and a
 * 402 or a 429 that outlasted every retry means a hosted plan or credit balance
 * is spent. Your own server has no plan: its 429 is an overload, reported as a
 * plain failure. Short rate limits are retried in `llm.ts` before this is reached.
 */
export function isUsageLimit(err: unknown, config: ModelRef): boolean {
	if (!(err instanceof LlmError)) return false;
	if (config?.provider === 'codex') return err.status === 429;
	return !!hostedProvider(config?.source) && (err.status === 402 || err.status === 429);
}

function usageLimitFor(config: ModelRef): UsageLimit {
	if (config?.provider === 'codex') return { provider: 'codex', name: 'ChatGPT', usageUrl: null };
	const hosted = hostedProvider(config?.source);
	return { provider: hosted?.id ?? 'custom', name: hosted?.name ?? 'Your server', usageUrl: hosted?.usageUrl ?? null };
}

/**
 * Turn a failed model call into words for the developer. ChatGPT's own
 * messages are already written for people; raw endpoint errors (`LLM 401: {…}`)
 * are replaced so response bodies never reach the UI.
 */
export function modelFailure(err: unknown, config: ModelRef, fallback: string): ModelFailure {
	if (isUsageLimit(err, config)) {
		const usageLimit = usageLimitFor(config);
		return { reason: `${usageLimit.name} is out of usage. Switch to another model, or wait for it to reset.`, usageLimit };
	}
	if (config?.provider === 'codex' && err instanceof LlmError) {
		return err.status === 401 ? { reason: err.message, signIn: true } : { reason: err.message };
	}
	if (isAuthFailure(err)) {
		const hosted = hostedProvider(config?.source);
		return { reason: hosted ? `${hosted.name} rejected the API key. Reconnect it in Settings → Models.` : 'The model endpoint rejected the API key. Update it in Settings → Models.' };
	}
	if (err instanceof LlmError && err.message && !/^LLM\b/.test(err.message)) return { reason: err.message };
	return { reason: fallback };
}
