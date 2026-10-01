<script lang="ts">
	import { Button } from '@sivir-ui/svelte/components/button';
	import * as Card from '@sivir-ui/svelte/components/card';
	import * as Typography from '@sivir-ui/svelte/components/typography';
	import type { CodexModel, ModelEntry } from '@recoder/shared';
	import CodexConnection from './codex-connection.svelte';
	import CustomEndpointRow from './custom-endpoint-row.svelte';
	import HostedProviderRow from './hosted-provider-row.svelte';
	import ModelPicker from './model-picker.svelte';
	import { hostedProviders } from '$lib/hosted-providers.svelte';
	import { modelSettingsUi } from '$lib/model-settings.svelte';
	import { settingsDraft } from '$lib/settings-draft.svelte';

	/** Mirror the connected ChatGPT catalog into the registry. */
	function syncCodexModels(models: CodexModel[]): void {
		const config = modelSettingsUi.config;
		if (!config) return;
		const existing = config.models.filter((entry) => entry.provider === 'codex');
		const same =
			existing.length === models.length &&
			models.every((model) => {
				const entry = existing.find((item) => item.id === `codex:${model.id}`);
				return (
					entry?.model === model.id &&
					(entry.efforts ?? []).join() === (model.efforts ?? []).join() &&
					entry.defaultEffort === model.defaultEffort
				);
			});
		if (same) return;
		const next: ModelEntry[] = models.map((model) => ({
			id: `codex:${model.id}`,
			provider: 'codex',
			label: model.label,
			model: model.id,
			baseUrl: null,
			apiKeyPreview: null,
			...(model.efforts?.length ? { efforts: model.efforts } : {}),
			...(model.defaultEffort ? { defaultEffort: model.defaultEffort } : {})
		}));
		void modelSettingsUi.saveModels([...config.models.filter((entry) => entry.provider !== 'codex'), ...next]);
	}

	function clearCodexModels(): void {
		const config = modelSettingsUi.config;
		if (!config?.models.some((entry) => entry.provider === 'codex')) return;
		void modelSettingsUi.saveModels(config.models.filter((entry) => entry.provider !== 'codex'));
	}
</script>

<section class="settings-section" aria-labelledby="models-provider">
	<Typography.H3 id="models-provider" class="settings-label">Providers</Typography.H3>
	<Card.Root class="settings-list provider-list">
		<CodexConnection active={modelSettingsUi.open} onSync={syncCodexModels} onClear={clearCodexModels} disabled={modelSettingsUi.saving} />
		{#if hostedProviders.list}
			{#each hostedProviders.list as provider (provider.id)}
				<HostedProviderRow {provider} />
			{/each}
		{:else if hostedProviders.error}
			<div class="settings-row">
				<p class="settings-row-desc m-0 min-w-0 flex-1 text-danger">{hostedProviders.error}</p>
				<Button variant="outline" onclick={() => void hostedProviders.load()}>Retry</Button>
			</div>
		{/if}
		<CustomEndpointRow />
	</Card.Root>
</section>

<section class="settings-section" aria-labelledby="models-roles">
	<Typography.H3 id="models-roles" class="settings-label">Models</Typography.H3>
	<Card.Root class="settings-list">
		<div class="settings-row role-row">
			<div class="min-w-0 flex-1">
				<p class="settings-row-name">Review</p>
				<p class="settings-row-desc">Plans the review, writes the summary and answers in chat</p>
			</div>
			<ModelPicker
				value={settingsDraft.orchestrator}
				onSelect={(choice) => (settingsDraft.orchestrator = choice)}
				label="Review model and reasoning effort"
			/>
		</div>
		<div class="settings-row role-row">
			<div class="min-w-0 flex-1">
				<p class="settings-row-name">Specialists</p>
				<p class="settings-row-desc">Every specialist in a review runs on this model</p>
			</div>
			<ModelPicker
				value={settingsDraft.specialist}
				onSelect={(choice) => (settingsDraft.specialist = choice)}
				placeholder="Same as Review"
				onFollow={() => (settingsDraft.specialist = null)}
				label="Specialist model and reasoning effort"
			/>
		</div>
	</Card.Root>
</section>
