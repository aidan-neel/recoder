import { z } from 'zod';
import type { ReasoningEffort } from '@recoder/shared';
import { effectiveReviewEnv, getStoredSettings } from './review-settings.js';

/**
 * Model routing for the review harness.
 *
 * API-key roles use OpenAI-compatible chat completions, so one client covers
 * vLLM (`http://host:8000/v1`), OpenRouter
 * (`https://openrouter.ai/api/v1`), and DashScope
 * (`https://dashscope-intl.aliyuncs.com/compatible-mode/v1`). Subscription
 * entries explicitly select the Codex App Server adapter instead; they never
 * inherit an API endpoint or key from the shared environment.
 *
 * One shared model by default; override per role when you want a stronger
 * (or cheaper) model for a specific lens:
 *
 *   RECODER_REVIEW_BASE_URL=https://openrouter.ai/api/v1
 *   RECODER_REVIEW_API_KEY=sk-or-...
 *   RECODER_REVIEW_MODEL=qwen/qwen-2.5-coder-32b-instruct
 *   RECODER_SECURITY_MODEL=qwen/qwen-2.5-coder-32b-instruct
 *   RECODER_PERF_MODEL=...
 */

import { REVIEW_ROLES, type ReviewRole } from './roles.js';

export { REVIEW_ROLES, type ReviewRole };

const configSchema = z.object({
	baseUrl: z.string().min(1),
	apiKey: z.string().min(1),
	model: z.string().min(1)
});

export interface RoleConfig {
	/** Unset API effort is omitted for endpoints that do not support reasoning. */
	reasoningEffort?: ReasoningEffort;
	provider?: 'openai-compatible' | 'codex';
	role: ReviewRole;
	baseUrl: string;
	apiKey: string;
	model: string;
}

/** Raw routing table. Throws when the shared base URL/key is missing. */
export function reviewConfig(): { baseUrl: string; apiKey: string; model: string } {
	const eff = effectiveReviewEnv();
	const parsed = configSchema.safeParse({
		baseUrl: eff.baseUrl,
		apiKey: eff.apiKey,
		model: eff.model
	});
	if (!parsed.success) {
		throw new Error(
			'reviewer not configured: set RECODER_REVIEW_BASE_URL, RECODER_REVIEW_API_KEY, RECODER_REVIEW_MODEL'
		);
	}
	return parsed.data;
}

/** True when any role can resolve to a model (registry or legacy env trio). */
export function isReviewConfigured(): boolean {
	try {
		configForRole('security');
		return true;
	} catch {
		return false;
	}
}

/**
 * Resolve a role to its concrete model.
 *
 * Registry first: role entry → shared entry → first entry, each falling back
 * to the global base URL/key. Legacy env trio still works when no entries
 * (or no matching entry) exist.
 */
export function configForRole(role: ReviewRole): RoleConfig {
	const stored = getStoredSettings();
	const reasoningEffort = stored.roleEfforts?.[role];
	const eff = effectiveReviewEnv();
	const entries = stored.models ?? [];
	const entryId = stored.roles?.[role] ?? stored.sharedModelId ?? entries[0]?.id;
	// A dangling pointer (entry deleted out-of-band) falls back to the first entry.
	const entry = entries.find((e) => e.id === entryId) ?? entries[0];
	if (entry) {
		if (entry.provider === 'codex') {
			return { role, provider: 'codex', model: entry.model, baseUrl: '', apiKey: '', reasoningEffort: reasoningEffort ?? 'low' };
		}
		const baseUrl = entry.baseUrl || eff.baseUrl;
		const apiKey = entry.apiKey || eff.apiKey;
		if (!baseUrl || !apiKey) {
			throw new Error(
				`reviewer not configured: model "${entry.label}" has no endpoint (set a base URL and API key)`
			);
		}
		return { role, baseUrl, apiKey, model: entry.model, reasoningEffort };
	}
	const shared = reviewConfig();
	const override = eff.roles[role];
	return { role, baseUrl: shared.baseUrl, apiKey: shared.apiKey, model: override || shared.model, reasoningEffort };
}

/** Caps so one PR can't blow the context window. */
export function reviewLimits(): { maxFiles: number; maxDiffChars: number; maxFileChars: number } {
	const eff = effectiveReviewEnv();
	return {
		maxFiles: eff.maxFiles,
		maxDiffChars: eff.maxDiffChars,
		maxFileChars: eff.maxFileChars
	};
}
