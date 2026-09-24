<script lang="ts">
	import * as Card from '@sivir-ui/svelte/components/card';
	import * as Typography from '@sivir-ui/svelte/components/typography';
	import type { CodexModel, ModelEntry, ReviewRole } from '@recoder/shared';
	import CodexConnection from './codex-connection.svelte';
	import EndpointCard from './endpoint-card.svelte';
	import ModelPicker from './model-picker.svelte';
	import { MODEL_ROLES, modelSettingsUi } from '$lib/model-settings.svelte';
	import { settingsDraft } from '$lib/settings-draft.svelte';
	import { formatAgentName } from '$lib/threads.svelte';

	const ROLE_NAME: Partial<Record<ReviewRole, string>> = { perf: 'Performance', docs: 'Documentation', api: 'API design' };
	const ROLE_DESC: Partial<Record<ReviewRole, string>> = {
		correctness: 'Always runs',
		patterns: 'Always runs on executable PRs'
	};
	/** Always-run roles first, then the rest as the planner selects them. */
	const ORDER: ReviewRole[] = ['correctness', 'patterns', ...MODEL_ROLES.filter((r) => r !== 'correctness' && r !== 'patterns')];

	const applyAll = $derived(modelSettingsUi.applyToSpecialists);

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
	<Typography.H3 id="models-provider" class="settings-label">Provider</Typography.H3>
	<div class="provider-grid">
		<CodexConnection active={modelSettingsUi.open} onSync={syncCodexModels} onClear={clearCodexModels} disabled={modelSettingsUi.saving} />
		<EndpointCard />
	</div>
</section>

<section class="settings-section" aria-labelledby="models-roles">
	<div class="flex items-baseline justify-between gap-3">
		<Typography.H3 id="models-roles" class="settings-label">Roles</Typography.H3>
		<Typography.Metadata class="text-[12.5px] text-fg-faint">Planning uses the Orchestrator model</Typography.Metadata>
	</div>
	<Card.Root class="settings-list">
		<div class="settings-row role-row">
			<div class="min-w-0 flex-1">
				<p class="settings-row-name">Orchestrator</p>
				<p class="settings-row-desc">Plans the review and writes the summary</p>
			</div>
			<ModelPicker
				value={settingsDraft.orchestrator}
				onSelect={(choice) => {
					settingsDraft.orchestrator = choice;
				}}
				label="Orchestrator model and reasoning effort"
			/>
		</div>
		{#each ORDER as role (role)}
			<div class="settings-row role-row">
				<div class="min-w-0 flex-1">
					<p class="settings-row-name">{ROLE_NAME[role] ?? formatAgentName(role)}</p>
					<p class="settings-row-desc">{ROLE_DESC[role] ?? 'Selected by relevance'}</p>
				</div>
				<ModelPicker
					value={applyAll ? null : (settingsDraft.roles[role] ?? null)}
					placeholder="Same as Orchestrator"
					disabled={applyAll}
					onSelect={(choice) => {
						settingsDraft.roles = { ...settingsDraft.roles, [role]: choice };
					}}
					label="{ROLE_NAME[role] ?? formatAgentName(role)} model and reasoning effort"
				/>
			</div>
		{/each}
	</Card.Root>
</section>
