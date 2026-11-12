/**
 * Model routing for the review harness.
 *
 * API-key models use OpenAI-compatible chat completions, so one client covers
 * vLLM (`http://host:8000/v1`), OpenRouter
 * (`https://openrouter.ai/api/v1`), and DashScope
 * (`https://dashscope-intl.aliyuncs.com/compatible-mode/v1`). A model an agent
 * CLI runs has an id `<agent id>:<model>` and goes through that agent's adapter.
 *
 * With no models saved, the shared environment names one:
 *
 *   RECODER_REVIEW_BASE_URL=https://openrouter.ai/api/v1
 *   RECODER_REVIEW_API_KEY=sk-or-...
 *   RECODER_REVIEW_MODEL=qwen/qwen-2.5-coder-32b-instruct
 */

import { z } from 'zod';
import {
	VLLM_MODEL_PREFIX,
	supportedEffort,
	type ModelProvider,
	type ModelRuntimeProfile,
	type ReasoningEffort
} from '@recoder/shared';
import { lockedModels, runLocked, type LockedModels } from './llm/locked-models.js';
import { recordLockMiss } from './metrics.js';
import { hostedProvider } from './model-providers.js';
import { resolveRuntime } from './runtime-profiles.js';
import { vllmTarget } from './vllm/vllm-models.js';
import { agentForModel } from '../agents/registry.js';
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
		throw new ModelConfigError('No model is set up. Pick one in Settings → Agent.');
	}

	return parsed.data;
}

/** Which stage pick is being resolved. */
type StageRole = 'orchestrator' | 'subagent' | 'verifier';

/** True when every configured pick resolves (registry or legacy env trio). */
export function isReviewConfigured(): boolean {
	try {
		configForVerifier();
		configForSubagent();
		configForOrchestrator();

		return true;
	} catch {
		return false;
	}
}

/**
 * Runs a review on the models picked when it starts. Changing the picks
 * mid-run then only affects reviews started after, so two reviews on
 * different models can run at once and no review mixes models. Resolved
 * synchronously, before `run` awaits anything. A pick that does not resolve
 * runs unlocked, so the review fails through its own error handling, and
 * each model it resolves is recorded as a lock miss in its metrics.
 */
export function withLockedModels<T>(run: () => T): T {
	let picks: LockedModels;

	try {
		picks = {
			orchestrator: resolveConfig('orchestrator'),
			subagent: resolveConfig('subagent'),
			verifier: resolveConfig('verifier')
		};
	} catch {
		return run();
	}

	return runLocked(picks, run);
}

/** The locked pick, or the live one; inside a pipeline the live one is a lock miss and is recorded as one. */
function pickFor(role: StageRole): ModelConfig {
	const picks = lockedModels();

	if (picks) return picks[role];

	recordLockMiss();

	return resolveConfig(role);
}

/** The Review model: reviewers, consolidation and chat. */
export function configForOrchestrator(): ModelConfig {
	return pickFor('orchestrator');
}

/** The second model: subagents and workers. Unset, it follows the Review model. */
export function configForSubagent(): ModelConfig {
	return pickFor('subagent');
}

/** The verifier model: verification stage. Unset, it follows the Review model. */
export function configForVerifier(): ModelConfig {
	return pickFor('verifier');
}

/**
 * Every stage's model, in stage order: Review, worker, verifier. Code that must cover each model a review can call
 * (sign-in checks, doctor) reads this list, so a new stage cannot be missed in one copy.
 */
export function stageConfigs(): readonly [review: ModelConfig, worker: ModelConfig, verifier: ModelConfig] {
	return [configForOrchestrator(), configForSubagent(), configForVerifier()];
}

/**
 * Whether the second model is a different model or effort from the Review
 * model. Only then does handing a reviewer's task to a worker save Review
 * usage; on the same model it only adds a conversation.
 */
export function hasSeparateSpecialist(): boolean {
	const review = configForOrchestrator();
	const specialist = configForSubagent();

	return (['provider', 'source', 'baseUrl', 'model', 'reasoningEffort'] as const).some(
		(key) => review[key] !== specialist[key]
	);
}

/**
 * The model behind an agent's messages, so a follow-up (chat, discussion or
 * fix) runs where the finding came from: a subagent's on the second model, a
 * verifier's on the verifier model, everything else on the Review model.
 */
export function configForAgent(agent: string | undefined): ModelConfig {
	if (agent === 'verifier') return configForVerifier();

	return agent === 'subagent' ? configForSubagent() : configForOrchestrator();
}

/** The id of the saved Review model: the pick, else the older shared pick, else the first saved entry. */
export function savedReviewModelId(): string | undefined {
	const stored = getStoredSettings();

	return stored.orchestratorModelId ?? stored.sharedModelId ?? stored.models?.[0]?.id;
}

/**
 * Resolve one of the three stage picks to its concrete model.
 *
 * There are three picks: the Review model, the second model for subagents and
 * workers, and the verifier model. An unset second or verifier pick follows
 * the Review model and its effort. A pick whose entry was deleted out-of-band
 * falls back to the first entry, each entry falling back to the global base
 * URL/key. The legacy env trio still works when no entries exist.
 */
function resolveConfig(role: StageRole): ModelConfig {
	const stored = getStoredSettings();
	const entries = stored.models ?? [];
	const reviewId = savedReviewModelId();

	const rolePicks: Record<StageRole, { id: string | null | undefined; effort: ReasoningEffort | null | undefined }> = {
		orchestrator: { id: reviewId, effort: stored.orchestratorEffort },
		subagent: { id: stored.specialistModelId, effort: stored.specialistEffort },
		verifier: { id: stored.verifierModelId, effort: stored.verifierEffort }
	};

	const { id: pickedId, effort: ownEffort } = rolePicks[role];
	const followsReview = role === 'orchestrator' || !pickedId;
	const entryId = followsReview ? reviewId : pickedId;
	const inheritedEffort = followsReview ? stored.orchestratorEffort : undefined;
	const requested = role === 'orchestrator' ? ownEffort : (ownEffort ?? inheritedEffort);

	if (entryId?.startsWith(VLLM_MODEL_PREFIX)) return vllmConfig(entryId, requested);

	const agentModel = entryId ? agentConfig(entryId, requested ?? undefined) : null;

	if (agentModel) return agentModel;

	return entryConfig(entries.find((e) => e.id === entryId) ?? entries[0], requested);
}

/**
 * One model by its id at a chosen effort, whatever the two picks are, for a
 * caller that must stay on the same model while the picks change (the
 * benchmark judge). Unlike a pick, an unknown id throws instead of falling
 * back to another model.
 */
export function configForModel(id: string, effort: ReasoningEffort | undefined): ModelConfig {
	if (id.startsWith(VLLM_MODEL_PREFIX)) return vllmConfig(id, effort);

	const agentModel = agentConfig(id, effort);

	if (agentModel) return agentModel;

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

		const runtime = resolveRuntime(entry.model, entry.runtime);
		const hosted = hostedProvider(entry.source);

		if (hosted) {
			const apiKey = stored.connections?.[hosted.id]?.apiKey;

			if (!apiKey) throw new ModelConfigError(`${hosted.name} isn't connected. Connect it in Settings → Agent.`);

			return { source: hosted.id, baseUrl: hosted.baseUrl, apiKey, model: entry.model, reasoningEffort, runtime };
		}

		const baseUrl = entry.baseUrl || eff.baseUrl;
		const apiKey = entry.apiKey || eff.apiKey;

		if (!baseUrl) throw new ModelConfigError(`${entry.label} has no endpoint. Pick another model in Settings → Agent.`);

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
 * A model captured from a vLLM server is not stored with the entries: the
 * server's list is kept in step by the sync, so the config comes from its id
 * (`vllm:<server>/<model>`). The call goes straight to the server's
 * OpenAI-compatible endpoint, naming the model id the server listed.
 */
function vllmConfig(entryId: string, requested: ReasoningEffort | null | undefined): ModelConfig {
	const target = vllmTarget(entryId);

	if ('error' in target) throw new ModelConfigError(target.error);

	const { baseUrl, apiKey, model, efforts, defaultEffort } = target;

	return {
		baseUrl,
		apiKey,
		model,
		reasoningEffort: supportedEffort(requested ?? undefined, efforts, defaultEffort),
		runtime: resolveRuntime(model)
	};
}

/**
 * A model an agent CLI runs (`claude-code:opus`, `opencode:openai/gpt-5`) is listed live or by the adapter
 * rather than stored, so the config comes from its id. It needs no endpoint or key; the adapter says which effort
 * the model takes and which hosted provider it routes to. Null when no agent owns the id.
 */
function agentConfig(id: string, requested: ReasoningEffort | undefined): ModelConfig | null {
	const owner = agentForModel(id);

	if (!owner) return null;

	const { agent, model } = owner;

	return { provider: agent.id, baseUrl: '', apiKey: '', model, ...agent.modelSettings(model, requested) };
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
