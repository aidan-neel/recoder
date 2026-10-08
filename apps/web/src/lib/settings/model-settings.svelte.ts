import type {
	ModelEntry,
	ModelProvider,
	Provider,
	ModelSettings,
	ModelSettingsPatch,
	ReasoningEffort
} from '@recoder/shared';
import { errorToast } from '../shell/notify';
import { readCache, writeCache } from '../shell/persisted-cache';
import { cacheableModelSettings } from './model-cache';
import { serverApi } from '../api/server-api';
import { looksLikeModelId, prettyModelName } from './model-name';

interface EffortOption {
	id: ReasoningEffort;
	label: string;
	description: string;
}

/** A model from the provider registry with the effort levels it accepts. */
export interface ModelOption {
	id: string;
	displayName: string;
	/** The agent CLI that runs it, by name; "Custom" for a direct endpoint. */
	agent: string;
	provider: string;
	/** Null when the model has no reasoning control. */
	efforts: EffortOption[] | null;
	defaultEffort: ReasoningEffort | null;
	/** Tokens per request, when the endpoint reported it. */
	contextWindow: number | null;
}

/** 131072 → "128K", 1048576 → "1M". */
export function formatContextWindow(tokens: number): string {
	if (tokens >= 1024 * 1024) return `${Math.round((tokens / (1024 * 1024)) * 10) / 10}M`;

	return `${Math.round(tokens / 1024)}K`;
}

export interface ModelChoice {
	modelId: string;
	effort: ReasoningEffort | null;
}

const EFFORT_TEXT: Record<ReasoningEffort, { label: string; description: string }> = {
	minimal: { label: 'Minimal', description: 'Near-instant' },
	low: { label: 'Low', description: 'Fastest, fewest tokens' },
	medium: { label: 'Medium', description: 'Balanced speed and depth' },
	high: { label: 'High', description: 'Slower, uses more of your plan' },
	xhigh: { label: 'Extra high', description: 'Deeper reasoning for hard problems' },
	max: { label: 'Max', description: 'Maximum depth, slowest' }
};

/** Effort words are always spelled out in full ("Medium", never "Med"). */
export function effortLabel(effort: ReasoningEffort): string {
	return EFFORT_TEXT[effort].label;
}

/** "GPT-5.6-Sol" → "5.6 Sol" for subscription models; an API entry still named by its id reads as a name. */
function displayName(entry: ModelEntry): string {
	const label = entry.label.replace(/\s*·\s*subscription$/i, '');

	if (entry.provider === 'codex') return label.replace(/^gpt-(?=\d)/i, '').replace(/-/g, ' ');

	return looksLikeModelId(label) ? prettyModelName(label) : label;
}

/** Names for hosted providers, so pickers can group by them before the provider list loads. */
const HOSTED_NAMES: Record<string, string> = {
	'opencode-go': 'OpenCode Go',
	opencode: 'OpenCode Zen',
	openrouter: 'OpenRouter'
};

/** Providers that are an app or CLI rather than an endpoint, by the name people know them by. */
const APP_NAMES: Partial<Record<ModelProvider, string>> = { codex: 'ChatGPT', 'claude-code': 'Claude Code' };

/** ChatGPT or Claude Code for those providers; null for an endpoint or an OpenCode provider. */
export function appName(provider: ModelProvider | undefined): string | null {
	return (provider && APP_NAMES[provider]) || null;
}

export function providerName(entry: ModelEntry): string {
	const app = appName(entry.provider);

	if (app) return app;
	if (entry.source) return HOSTED_NAMES[entry.source] ?? entry.source;

	const url = entry.baseUrl ?? '';

	if (/openrouter/i.test(url)) return 'OpenRouter';
	if (/dashscope/i.test(url)) return 'DashScope';
	if (/openai\.com/i.test(url)) return 'OpenAI';

	try {
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- local, not reactive
		const host = new URL(url).hostname;

		return /^(localhost|127\.|10\.|192\.168\.)/.test(host) ? 'Local endpoint' : host;
	} catch {
		return 'OpenAI-compatible';
	}
}

export function toModelOption(entry: ModelEntry): ModelOption {
	const efforts = entry.efforts?.length ? entry.efforts : null;

	const defaultEffort = efforts
		? entry.defaultEffort && efforts.includes(entry.defaultEffort)
			? entry.defaultEffort
			: efforts.includes('medium')
				? 'medium'
				: efforts[0]
		: null;

	return {
		id: entry.id,
		displayName: displayName(entry),
		agent: entry.agent ?? 'Custom',
		provider: providerName(entry),
		efforts:
			efforts?.map((id) => ({
				id,
				label: EFFORT_TEXT[id].label,
				description: EFFORT_TEXT[id].description
			})) ?? null,
		defaultEffort,
		contextWindow: entry.contextWindow ?? null
	};
}

/** ChatGPT models only return summaries of their reasoning, never the reasoning itself. */
export function summarizesReasoning(modelId: string | null | undefined): boolean {
	if (!modelId) return false;

	return (
		modelSettingsUi.config?.models.some(
			(item) => (item.model === modelId || item.id === modelId) && item.provider === 'codex'
		) ?? false
	);
}

/**
 * What to show for a model id in the UI: the configured entry's name
 * ("Ornith 1.5 35B"), else a tidied id ("ornith-ai/Ornith-1.5-35B-A3B" → "Ornith 1.5 35B A3B").
 * Raw ids stay available in tooltips.
 */
export function modelLabel(modelId: string | null | undefined): string {
	if (!modelId) return '';

	const entry = modelSettingsUi.config?.models.find((item) => item.model === modelId || item.id === modelId);

	if (entry) return toModelOption(entry).displayName;

	return prettyModelName(modelId);
}

/** Keep an effort only when the model offers it; otherwise use the model default. */
export function resolveEffort(
	model: ModelOption | undefined,
	effort: ReasoningEffort | null | undefined
): ReasoningEffort | null {
	if (!model?.efforts) return null;

	return effort && model.efforts.some((option) => option.id === effort) ? effort : model.defaultEffort;
}

export type SettingsSection = 'models' | 'connections' | 'harness' | 'guidelines' | 'appearance';

/** A dialog to open inside the section as soon as Settings shows it. */
type SettingsIntent = { kind: 'connect'; provider: Provider } | { kind: 'browse-repos' } | { kind: 'add-provider' };

/** Last-seen settings, so pickers paint model names before the server answers. */
const CACHE_KEY = 'model-settings';

/** Global open state + cached config for the model settings modal. */
class ModelSettingsUi {
	open = $state(false);
	/** Settings nav section shown when the modal opens. */
	section = $state<SettingsSection>('models');
	config = $state<ModelSettings | null>(null);
	loading = $state(false);
	saving = $state(false);
	error = $state<string | null>(null);
	/** Consumed by the section that owns the dialog. */
	intent = $state<SettingsIntent | null>(null);

	/** Registry models with their capabilities, mapped once per config. */
	models = $derived<ModelOption[]>((this.config?.models ?? []).map(toModelOption));

	private inflight: Promise<void> | null = null;
	private fresh = false;

	show(section: SettingsSection = 'models', intent: SettingsIntent | null = null): void {
		this.section = section;
		this.intent = intent;
		this.open = true;
		void this.load();
	}

	hide(): void {
		this.open = false;
	}

	/** The Review model and effort (the orchestrator): what the composer picker shows. */
	get orchestrator(): ModelChoice | null {
		const config = this.config;

		if (!config) return null;

		const modelId = config.orchestratorModelId ?? config.sharedModelId ?? config.models[0]?.id;
		const model = this.models.find((item) => item.id === modelId);

		if (!model) return null;

		return { modelId: model.id, effort: resolveEffort(model, config.orchestratorEffort) };
	}

	/** The one model every specialist runs on, mirroring the server: unset follows Review. */
	get specialist(): ModelChoice | null {
		const config = this.config;

		if (!config?.specialistModelId) return this.orchestrator;

		const model = this.models.find((item) => item.id === config.specialistModelId);

		if (!model) return this.orchestrator;

		return { modelId: model.id, effort: resolveEffort(model, config.specialistEffort) };
	}

	/** Optimistically apply a patch, then persist; reverts and reports on failure. */
	async update(
		patch: Pick<
			ModelSettingsPatch,
			'orchestratorModelId' | 'orchestratorEffort' | 'specialistModelId' | 'specialistEffort'
		>
	): Promise<boolean> {
		const previous = this.config;

		if (previous) this.config = { ...previous, ...patch };

		const ok = await this.save(patch);

		if (!ok) {
			this.config = previous;
			errorToast('Model settings were not saved', this.error ?? undefined);
		}

		return ok;
	}

	selectOrchestrator(choice: ModelChoice): Promise<boolean> {
		return this.update({ orchestratorModelId: choice.modelId, orchestratorEffort: choice.effort });
	}

	selectSpecialist(choice: ModelChoice): Promise<boolean> {
		return this.update({ specialistModelId: choice.modelId, specialistEffort: choice.effort });
	}

	/**
	 * Paints the last-seen settings at once, then fetches the current ones once
	 * per page load. Call it from onMount: the server render has no storage.
	 */
	ensure(): Promise<void> {
		if (!this.config) this.config = readCache<ModelSettings>(CACHE_KEY);

		return this.fresh ? Promise.resolve() : this.load();
	}

	/** Concurrent callers share one request. */
	load(): Promise<void> {
		this.inflight ??= this.fetch().finally(() => (this.inflight = null));

		return this.inflight;
	}

	private async fetch(): Promise<void> {
		this.loading = true;
		this.error = null;

		try {
			this.apply(await serverApi.getModelSettings());
			this.fresh = true;
		} catch (e) {
			this.error = e instanceof Error ? e.message : 'Failed to load model settings.';
		} finally {
			this.loading = false;
		}
	}

	private apply(config: ModelSettings): void {
		this.config = config;
		writeCache(CACHE_KEY, cacheableModelSettings(config));
	}

	async save(patch: ModelSettingsPatch): Promise<boolean> {
		this.saving = true;
		this.error = null;

		try {
			this.apply(await serverApi.saveModelSettings(patch));

			return true;
		} catch (e) {
			this.error = e instanceof Error ? e.message : 'Failed to save model settings.';

			return false;
		} finally {
			this.saving = false;
		}
	}
}

export const modelSettingsUi = new ModelSettingsUi();
