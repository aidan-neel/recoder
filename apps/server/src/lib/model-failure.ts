import type { ModelFailure } from '@recoder/shared';
import { LlmError } from './llm.js';
import { isAuthFailure } from './planner.js';

/**
 * Turn a failed model call into words for the developer. ChatGPT's own
 * messages are already written for people; raw endpoint errors (`LLM 401: {…}`)
 * are replaced so response bodies never reach the UI.
 */
export function modelFailure(err: unknown, provider: 'openai-compatible' | 'codex' | undefined, fallback: string): ModelFailure {
	if (provider === 'codex' && err instanceof LlmError) {
		return err.status === 401 ? { reason: err.message, signIn: true } : { reason: err.message };
	}
	if (isAuthFailure(err)) return { reason: 'The model endpoint rejected the API key. Update it in Settings → Models.' };
	if (err instanceof LlmError && err.message && !/^LLM\b/.test(err.message)) return { reason: err.message };
	return { reason: fallback };
}
