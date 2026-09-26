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
 * entries explicitly select the direct ChatGPT OAuth adapter instead; they never
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
	// Optional: local servers (vLLM, Ollama, LM Studio) usually run without a key.
	apiKey: z.string().default(''),
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

/** No model can serve a request; the message tells the developer what to set. */
export class ModelConfigError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'ModelConfigError';
	}
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
		throw new ModelConfigError('No model is set up. Add one in Settings → Models.');
	}
	return parsed.data;
}

/** True when any role can resolve to a model (registry or legacy env trio). */
export function isReviewConfigured(): boolean {
	try {
		configForRole('security');
		configForOrchestrator();
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
export function configForOrchestrator(): RoleConfig {
	return resolveConfig('correctness', true);
}

export function configForRole(role: ReviewRole): RoleConfig {
	return resolveConfig(role, false);
}

function resolveConfig(role: ReviewRole, orchestrator: boolean): RoleConfig {
	const stored = getStoredSettings();
	const eff = effectiveReviewEnv();
	const entries = stored.models ?? [];
	const reviewId = stored.orchestratorModelId ?? stored.sharedModelId ?? entries[0]?.id;
	// Two picks: the Review model (planning, summary, chat) and one Specialist model for every
	// specialist. An unset Specialist pick follows the Review model and its effort.
	const followsReview = orchestrator || !stored.specialistModelId;
	const entryId = followsReview ? reviewId : stored.specialistModelId;
	const requested = orchestrator ? stored.orchestratorEffort
		: stored.specialistEffort ?? (followsReview ? stored.orchestratorEffort : undefined);
	// A dangling pointer (entry deleted out-of-band) falls back to the first entry.
	const entry = entries.find((e) => e.id === entryId) ?? entries[0];
	if (entry) {
		const reasoningEffort = supportedEffort(requested ?? undefined, entry.efforts, entry.defaultEffort);
		if (entry.provider === 'codex') {
			return { role, provider: 'codex', model: entry.model, baseUrl: '', apiKey: '', reasoningEffort: reasoningEffort ?? entry.defaultEffort ?? 'medium' };
		}
		const baseUrl = entry.baseUrl || eff.baseUrl;
		const apiKey = entry.apiKey || eff.apiKey;
		if (!baseUrl) throw new ModelConfigError(`${entry.label} has no endpoint. Set a base URL in Settings → Models.`);
		return { role, baseUrl, apiKey, model: entry.model, reasoningEffort };
	}
	const shared = reviewConfig();
	return { role, baseUrl: shared.baseUrl, apiKey: shared.apiKey, model: shared.model, reasoningEffort: requested ?? undefined };
}

/**
 * A saved effort the model no longer offers (e.g. after switching models) falls
 * back to the model default: medium when offered, else the first listed level.
 */
function supportedEffort(
	requested: ReasoningEffort | null | undefined,
	offered: ReasoningEffort[] | undefined,
	fallback: ReasoningEffort | undefined
): ReasoningEffort | undefined {
	if (!requested) return undefined;
	if (!offered?.length || offered.includes(requested)) return requested;
	if (fallback && offered.includes(fallback)) return fallback;
	return offered.includes('medium') ? 'medium' : offered[0];
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
