/**
 * Model routing for the review harness.
 *
 * API-key models use OpenAI-compatible chat completions, so one client covers
 * vLLM (`http://host:8000/v1`), OpenRouter
 * (`https://openrouter.ai/api/v1`), and DashScope
 * (`https://dashscope-intl.aliyuncs.com/compatible-mode/v1`). Subscription
 * entries explicitly select the direct ChatGPT OAuth adapter instead; they never
 * inherit an API endpoint or key from the shared environment.
 *
 * With no models saved, the shared environment names one:
 *
 *   RECODER_REVIEW_BASE_URL=https://openrouter.ai/api/v1
 *   RECODER_REVIEW_API_KEY=sk-or-...
 *   RECODER_REVIEW_MODEL=qwen/qwen-2.5-coder-32b-instruct
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import { z } from 'zod';
import type { ModelProvider, ModelRuntimeProfile, ReasoningEffort } from '@recoder/shared';
import { hostedProvider } from './model-providers.js';
import { resolveRuntime } from './runtime-profiles.js';
import { OPENCODE_MODEL_PREFIX } from '../agents/opencode/opencode.js';
import { effectiveReviewEnv, getStoredSettings, type StoredModelEntry } from '../review/session/review-settings.js';

const configSchema = z.object({
	baseUrl: z.string().min(1),
	/** Optional: local servers (vLLM, Ollama, LM Studio) usually run without a key. */
	apiKey: z.string().default(''),
	model: z.string().min(1)
});

export interface ModelConfig {
	/** Unset API effort is omitted for endpoints that do not support reasoning. */
	reasoningEffort?: ReasoningEffort;
	provider?: ModelProvider;
	/** Sampling for this model: its entry's settings over the built-in profile; unset on transports that take none. */
	runtime?: ModelRuntimeProfile;
	/** Hosted provider id (`opencode-go`…) when the model came from one; for OpenCode, its provider id. */
	source?: string;
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
function reviewConfig(): { baseUrl: string; apiKey: string; model: string } {
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

/** True when both models resolve (registry or legacy env trio). */
export function isReviewConfigured(): boolean {
	try {
		configForSubagent();
		configForOrchestrator();

		return true;
	} catch {
		return false;
	}
}

/** Both picks as a review saw them when it started. */
interface LockedModels {
	orchestrator: ModelConfig;
	subagent: ModelConfig;
}

/** The picks of the review whose work is running, held in memory only since a config carries its API key. */
const locked = new AsyncLocalStorage<LockedModels>();

/**
 * Runs a review on the models picked when it starts. Changing the picks
 * mid-run then only affects reviews started after, so two reviews on
 * different models can run at once and no review mixes models. Resolved
 * synchronously, before `run` awaits anything. A pick that does not resolve
 * runs unlocked, so the review fails through its own error handling.
 */
export function withLockedModels<T>(run: () => T): T {
	let picks: LockedModels;

	try {
		picks = { orchestrator: resolveConfig(true), subagent: resolveConfig(false) };
	} catch {
		return run();
	}

	return locked.run(picks, run);
}

/** The Review model: reviewers, consolidation and chat. */
export function configForOrchestrator(): ModelConfig {
	return locked.getStore()?.orchestrator ?? resolveConfig(true);
}

/** The second model: subagents and verifiers. Unset, it follows the Review model. */
export function configForSubagent(): ModelConfig {
	return locked.getStore()?.subagent ?? resolveConfig(false);
}

/**
 * The model behind an agent's messages, so a follow-up (chat, discussion or
 * fix) runs where the finding came from: a subagent's on the second model,
 * everything else on the Review model.
 */
export function configForAgent(agent: string | undefined): ModelConfig {
	return agent === 'subagent' ? configForSubagent() : configForOrchestrator();
}

/**
 * Resolve one of the two picks to its concrete model.
 *
 * There are two picks: the Review model and the second model for subagents
 * and verifiers. An unset second pick follows the Review model and its effort.
 * A pick whose entry was deleted out-of-band falls back to the first entry,
 * each entry falling back to the global base URL/key. The legacy env trio
 * still works when no entries exist.
 */
function resolveConfig(orchestrator: boolean): ModelConfig {
	const stored = getStoredSettings();
	const entries = stored.models ?? [];
	const reviewId = stored.orchestratorModelId ?? stored.sharedModelId ?? entries[0]?.id;
	const followsReview = orchestrator || !stored.specialistModelId;
	const entryId = followsReview ? reviewId : stored.specialistModelId;

	const requested = orchestrator
		? stored.orchestratorEffort
		: (stored.specialistEffort ?? (followsReview ? stored.orchestratorEffort : undefined));

	if (entryId?.startsWith(OPENCODE_MODEL_PREFIX)) return openCodeConfig(entryId, requested ?? undefined);

	return entryConfig(entries.find((e) => e.id === entryId) ?? entries[0], requested);
}

/**
 * One model by its id at a chosen effort, whatever the two picks are, for a
 * caller that must stay on the same model while the picks change (the
 * benchmark judge). Unlike a pick, an unknown id throws instead of falling
 * back to another model.
 */
export function configForModel(id: string, effort: ReasoningEffort | undefined): ModelConfig {
	if (id.startsWith(OPENCODE_MODEL_PREFIX)) return openCodeConfig(id, effort);

	const entry = getStoredSettings().models?.find((e) => e.id === id);

	if (!entry) throw new ModelConfigError(`No model ${id} is set up.`);

	return entryConfig(entry, effort);
}

/** A saved entry's config, or the shared environment's model when there is no entry. */
function entryConfig(entry: StoredModelEntry | undefined, requested: ReasoningEffort | null | undefined): ModelConfig {
	const stored = getStoredSettings();
	const eff = effectiveReviewEnv();

	if (entry) {
		const reasoningEffort = supportedEffort(requested ?? undefined, entry.efforts, entry.defaultEffort);

		if (entry.provider === 'codex') {
			return {
				provider: 'codex',
				model: entry.model,
				baseUrl: '',
				apiKey: '',
				reasoningEffort: reasoningEffort ?? entry.defaultEffort ?? 'medium'
			};
		}

		const runtime = resolveRuntime(entry.model, entry.runtime);
		const hosted = hostedProvider(entry.source);

		if (hosted) {
			const apiKey = stored.connections?.[hosted.id]?.apiKey;

			if (!apiKey) throw new ModelConfigError(`${hosted.name} isn't connected. Connect it in Settings → Models.`);

			return { source: hosted.id, baseUrl: hosted.baseUrl, apiKey, model: entry.model, reasoningEffort, runtime };
		}

		const baseUrl = entry.baseUrl || eff.baseUrl;
		const apiKey = entry.apiKey || eff.apiKey;

		if (!baseUrl) throw new ModelConfigError(`${entry.label} has no endpoint. Set a base URL in Settings → Models.`);

		return { baseUrl, apiKey, model: entry.model, reasoningEffort, runtime };
	}

	const shared = reviewConfig();

	return {
		baseUrl: shared.baseUrl,
		apiKey: shared.apiKey,
		model: shared.model,
		runtime: resolveRuntime(shared.model),
		reasoningEffort: requested ?? undefined
	};
}

/**
 * An OpenCode model is listed live from the CLI rather than stored, so the
 * config comes from its id (`opencode:<provider>/<model>`). The transport
 * checks the effort against the model's variants.
 */
function openCodeConfig(entryId: string, reasoningEffort: ReasoningEffort | undefined): ModelConfig {
	const model = entryId.slice(OPENCODE_MODEL_PREFIX.length);

	return { provider: 'opencode', source: model.split('/')[0], baseUrl: '', apiKey: '', model, reasoningEffort };
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
