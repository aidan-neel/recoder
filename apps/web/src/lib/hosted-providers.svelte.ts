import type { CatalogModel, HostedProvider, ModelEntry } from '@recoder/shared';
import { modelSettingsUi } from '$lib/model-settings.svelte';
import { serverApi } from '$lib/server-api';

/** Hosted providers (OpenCode Go, OpenRouter…) and the models each can serve. */
class HostedProvidersState {
	list = $state<HostedProvider[] | null>(null);
	error = $state<string | null>(null);
	private catalogs = new Map<string, Promise<CatalogModel[]>>();

	async load(): Promise<void> {
		try {
			this.list = await serverApi.listHostedProviders();
			this.error = null;
			void this.refreshModels();
		} catch (e) {
			this.error = e instanceof Error ? e.message : 'Could not load providers.';
		}
	}

	private refreshed = false;

	/**
	 * Models added before the catalog reported reasoning efforts (or with
	 * an older name) catch up with it once per visit, so pickers offer the
	 * real effort levels.
	 */
	private async refreshModels(): Promise<void> {
		const config = modelSettingsUi.config;
		if (this.refreshed || !config) return;
		this.refreshed = true;
		const sources = [...new Set(config.models.flatMap((entry) => entry.source && this.get(entry.source)?.connected ? [entry.source] : []))];
		let changed = false;
		let models = config.models;
		for (const source of sources) {
			const catalog = await this.catalog(source).catch(() => null);
			if (!catalog) continue;
			const byId = new Map(catalog.map((model) => [model.id, model] as const));
			models = models.map((entry) => {
				const live = entry.source === source ? byId.get(entry.model) : undefined;
				if (!live) return entry;
				const next = withCatalog(entry, live);
				if (JSON.stringify(next) !== JSON.stringify(entry)) changed = true;
				return next;
			});
		}
		if (changed && modelSettingsUi.config === config) await modelSettingsUi.saveModels(models);
	}

	get(id: string): HostedProvider | undefined {
		return this.list?.find((provider) => provider.id === id);
	}

	/** Models added from this provider. */
	models(id: string): ModelEntry[] {
		return (modelSettingsUi.config?.models ?? []).filter((entry) => entry.source === id);
	}

	/** Throws with the provider's words when the key is refused. */
	async connect(id: string, apiKey: string): Promise<void> {
		const result = await serverApi.connectHostedProvider(id, apiKey);
		this.list = result.providers;
		modelSettingsUi.config = result.settings;
	}

	async disconnect(id: string): Promise<void> {
		const result = await serverApi.disconnectHostedProvider(id);
		this.list = result.providers;
		modelSettingsUi.config = result.settings;
	}

	/** Loaded once per visit; a failed load is retried next time. */
	catalog(id: string): Promise<CatalogModel[]> {
		let pending = this.catalogs.get(id);
		if (!pending) {
			pending = serverApi.hostedProviderCatalog(id);
			pending.catch(() => this.catalogs.delete(id));
			this.catalogs.set(id, pending);
		}
		return pending;
	}

	/**
	 * Make this provider's models exactly `picked`, in one save. Models already
	 * added keep their ids, so Review and Specialist picks on them survive.
	 */
	setModels(id: string, picked: CatalogModel[]): Promise<boolean> {
		const config = modelSettingsUi.config;
		if (!config) return Promise.resolve(false);
		const wanted = new Set(picked.map((model) => model.id));
		const byId = new Map(picked.map((model) => [model.id, model] as const));
		const kept = config.models
			.filter((entry) => entry.source !== id || wanted.has(entry.model))
			.map((entry) => (entry.source === id && byId.has(entry.model) ? withCatalog(entry, byId.get(entry.model)!) : entry));
		const have = new Set(kept.filter((entry) => entry.source === id).map((entry) => entry.model));
		const fresh: ModelEntry[] = picked.filter((model) => !have.has(model.id)).map((model) => withCatalog({
			id: `${id}:${model.id}`,
			provider: 'openai-compatible',
			source: id,
			label: model.name,
			model: model.id,
			baseUrl: null,
			apiKeyPreview: null
		}, model));
		return modelSettingsUi.saveModels([...kept, ...fresh]);
	}
}

/** An entry with the catalog's name, context window and reasoning efforts. */
function withCatalog(entry: ModelEntry, model: CatalogModel): ModelEntry {
	const { efforts: _e, defaultEffort: _d, contextWindow: _c, ...rest } = entry;
	return {
		...rest,
		label: model.name,
		...(model.contextWindow ? { contextWindow: model.contextWindow } : entry.contextWindow ? { contextWindow: entry.contextWindow } : {}),
		...(model.efforts?.length ? { efforts: model.efforts } : {}),
		...(model.defaultEffort ? { defaultEffort: model.defaultEffort } : {})
	};
}

export const hostedProviders = new HostedProvidersState();
