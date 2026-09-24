import type { ModelEntry, ModelSettings, ModelSettingsPatch, ReasoningEffort, ReviewRole } from '@recoder/shared';
import { errorToast } from './notify';
import { serverApi } from './server-api';

export const MODEL_ROLES: ReviewRole[] = [
	'security',
	'perf',
	'correctness',
	'docs',
	'dedup',
	'patterns',
	'testing',
	'errors',
	'concurrency',
	'api'
];

export interface EffortOption {
	id: ReasoningEffort;
	label: string;
	description: string;
}

/** A model from the provider registry with the effort levels it accepts. */
export interface ModelOption {
	id: string;
	displayName: string;
	provider: string;
	/** Null when the model has no reasoning control. */
	efforts: EffortOption[] | null;
	defaultEffort: ReasoningEffort | null;
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

/** "GPT-5.6-Sol" → "5.6 Sol" for subscription models; API entries keep their label. */
function displayName(entry: ModelEntry): string {
	const label = entry.label.replace(/\s*·\s*subscription$/i, '');
	return entry.provider === 'codex' ? label.replace(/^gpt-(?=\d)/i, '').replace(/-/g, ' ') : label;
}

function providerName(entry: ModelEntry): string {
	if (entry.provider === 'codex') return 'ChatGPT';
	const url = entry.baseUrl ?? '';
	if (/openrouter/i.test(url)) return 'OpenRouter';
	if (/dashscope/i.test(url)) return 'DashScope';
	if (/openai\.com/i.test(url)) return 'OpenAI';
	try {
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
			: efforts.includes('medium') ? 'medium' : efforts[0]
		: null;
	return {
		id: entry.id,
		displayName: displayName(entry),
		provider: providerName(entry),
		efforts: efforts?.map((id) => ({
			id,
			label: EFFORT_TEXT[id].label,
			description: id === defaultEffort ? 'Model default' : EFFORT_TEXT[id].description
		})) ?? null,
		defaultEffort
	};
}

/** Keep an effort only when the model offers it; otherwise use the model default. */
export function resolveEffort(model: ModelOption | undefined, effort: ReasoningEffort | null | undefined): ReasoningEffort | null {
	if (!model?.efforts) return null;
	return effort && model.efforts.some((option) => option.id === effort) ? effort : model.defaultEffort;
}

export type SettingsSection = 'models' | 'connections' | 'harness' | 'guidelines' | 'appearance';

/** Global open state + cached config for the model settings modal. */
class ModelSettingsUi {
	open = $state(false);
	/** Settings nav section shown when the modal opens. */
	section = $state<SettingsSection>('models');
	config = $state<ModelSettings | null>(null);
	loading = $state(false);
	saving = $state(false);
	error = $state<string | null>(null);

	show(section: SettingsSection = 'models'): void {
		this.section = section;
		this.open = true;
		void this.load();
	}

	hide(): void {
		this.open = false;
	}

	/** Registry models with their capabilities. */
	get models(): ModelOption[] {
		return (this.config?.models ?? []).map(toModelOption);
	}

	/** The Orchestrator's model and effort: what the composer picker shows. */
	get orchestrator(): ModelChoice | null {
		const config = this.config;
		if (!config) return null;
		const modelId = config.orchestratorModelId ?? config.sharedModelId ?? config.models[0]?.id;
		const model = this.models.find((item) => item.id === modelId);
		if (!model) return null;
		return { modelId: model.id, effort: resolveEffort(model, config.orchestratorEffort ?? config.roleEfforts?.correctness) };
	}

	get applyToSpecialists(): boolean {
		return this.config?.applyToSpecialists ?? false;
	}

	/** Optimistically apply a patch, then persist; reverts and reports on failure. */
	async update(patch: Pick<ModelSettingsPatch, 'orchestratorModelId' | 'orchestratorEffort' | 'applyToSpecialists'>): Promise<boolean> {
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

	/** The model a specialist role runs on, mirroring the server's routing. */
	roleChoice(role: ReviewRole): ModelChoice | null {
		const config = this.config;
		if (!config) return null;
		if (config.applyToSpecialists) return this.orchestrator;
		const modelId = config.roles[role] ?? config.specialistModelId ?? config.sharedModelId ?? config.models[0]?.id;
		const model = this.models.find((item) => item.id === modelId);
		if (!model) return null;
		return { modelId: model.id, effort: resolveEffort(model, config.roleEfforts?.[role]) };
	}

	async selectRole(role: ReviewRole, choice: ModelChoice): Promise<boolean> {
		const previous = this.config;
		if (previous) {
			this.config = {
				...previous,
				roles: { ...previous.roles, [role]: choice.modelId },
				roleEfforts: choice.effort ? { ...previous.roleEfforts, [role]: choice.effort } : previous.roleEfforts
			};
		}
		const ok = await this.save({
			roles: { [role]: choice.modelId },
			...(choice.effort ? { roleEfforts: { [role]: choice.effort } } : {})
		});
		if (!ok) {
			this.config = previous;
			errorToast('Model settings were not saved', this.error ?? undefined);
		}
		return ok;
	}

	setApplyToSpecialists(on: boolean): Promise<boolean> {
		return this.update({ applyToSpecialists: on });
	}

	private capabilitiesChecked = false;

	/**
	 * ChatGPT entries saved before effort discovery worked have no effort list.
	 * Fill them in from the live catalog once, so pickers show real options.
	 */
	private async refreshCodexCapabilities(): Promise<void> {
		const config = this.config;
		if (this.capabilitiesChecked || !config) return;
		if (!config.models.some((entry) => entry.provider === 'codex' && !entry.efforts?.length)) return;
		this.capabilitiesChecked = true;
		try {
			const catalog = new Map((await serverApi.getCodexModels()).map((model) => [model.id, model] as const));
			let changed = false;
			const models = config.models.map((entry) => {
				const live = entry.provider === 'codex' ? catalog.get(entry.model) : undefined;
				if (!live?.efforts?.length) return entry;
				changed = true;
				return { ...entry, efforts: live.efforts, defaultEffort: live.defaultEffort };
			});
			if (!changed) return;
			this.config = { ...config, models };
			await this.save({
				models: models.map((entry) => ({
					id: entry.id,
					provider: entry.provider ?? 'openai-compatible',
					label: entry.label,
					model: entry.model,
					...(entry.baseUrl ? { baseUrl: entry.baseUrl } : {}),
					apiKey: '',
					...(entry.efforts?.length ? { efforts: entry.efforts } : {}),
					...(entry.defaultEffort ? { defaultEffort: entry.defaultEffort } : {})
				}))
			});
		} catch {
			// Catalog unavailable (signed out, offline): keep what's saved.
		}
	}

	/** Replace the model registry (catalog sync, endpoint models). `newKey` sets an entry's key. */
	saveModels(models: (ModelEntry & { newKey?: string })[]): Promise<boolean> {
		return this.save({
			models: models.map((entry) => ({
				id: entry.id,
				provider: entry.provider ?? 'openai-compatible',
				label: entry.label,
				model: entry.model,
				...(entry.baseUrl ? { baseUrl: entry.baseUrl } : {}),
				apiKey: entry.newKey ?? '',
				...(entry.efforts?.length ? { efforts: entry.efforts } : {}),
				...(entry.defaultEffort ? { defaultEffort: entry.defaultEffort } : {})
			}))
		});
	}

	async load(): Promise<void> {
		this.loading = true;
		this.error = null;
		try {
			this.config = await serverApi.getModelSettings();
			void this.refreshCodexCapabilities();
		} catch (e) {
			this.error = e instanceof Error ? e.message : 'Failed to load model settings.';
		} finally {
			this.loading = false;
		}
	}

	async save(patch: ModelSettingsPatch): Promise<boolean> {
		this.saving = true;
		this.error = null;
		try {
			this.config = await serverApi.saveModelSettings(patch);
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
