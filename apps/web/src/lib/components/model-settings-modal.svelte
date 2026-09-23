<script lang="ts">
	import X from '@lucide/svelte/icons/x';
	import * as Alert from '@sivir-ui/svelte/components/alert';
	import { Button } from '@sivir-ui/svelte/components/button';
	import * as Modal from '@sivir-ui/svelte/components/modal';
	import { ScrollArea } from '@sivir-ui/svelte/components/scroll-area';
	import * as Tabs from '@sivir-ui/svelte/components/tabs';
	import * as Typography from '@sivir-ui/svelte/components/typography';
	import SettingsAppearance from './settings-appearance.svelte';
	import SettingsConnections from './settings-connections.svelte';
	import SettingsHarness from './settings-harness.svelte';
	import SettingsModels from './settings-models.svelte';
	import Skeleton from './ui/skeleton.svelte';
	import { modelSettingsUi, type SettingsSection } from '$lib/model-settings.svelte';
	import { settingsDraft } from '$lib/settings-draft.svelte';

	const SECTIONS: { id: SettingsSection; label: string }[] = [
		{ id: 'models', label: 'Models' },
		{ id: 'connections', label: 'Connections' },
		{ id: 'harness', label: 'Review harness' },
		{ id: 'appearance', label: 'Appearance' }
	];

	const config = $derived(modelSettingsUi.config);
	const title = $derived(SECTIONS.find((s) => s.id === modelSettingsUi.section)?.label ?? 'Settings');
	let saveError = $state<string | null>(null);

	$effect(() => {
		if (!modelSettingsUi.open) {
			settingsDraft.reset();
			saveError = null;
			return;
		}
		if (config && !settingsDraft.seeded) settingsDraft.seed(config);
	});

	/** Save what changed; nothing changed just closes. */
	async function save(): Promise<void> {
		if (modelSettingsUi.saving) return;
		const patch = settingsDraft.patch();
		if (Object.keys(patch).length === 0) {
			modelSettingsUi.hide();
			return;
		}
		saveError = null;
		if (await modelSettingsUi.save(patch)) modelSettingsUi.hide();
		else saveError = modelSettingsUi.error ?? 'Settings were not saved.';
	}

	function onKey(event: KeyboardEvent): void {
		if (!modelSettingsUi.open || event.key !== 'Enter' || !(event.metaKey || event.ctrlKey)) return;
		event.preventDefault();
		void save();
	}
</script>

<svelte:window onkeydown={onKey} />

<Modal.Root bind:open={modelSettingsUi.open}>
	<Modal.Content
		size="xl"
		class="settings-modal"
		surfaceClass="settings-surface"
		showClose={false}
		allowEscape={!modelSettingsUi.saving}
		allowClickOutside={!modelSettingsUi.saving}
		aria-label="Settings"
	>
		<Tabs.Root
			value={modelSettingsUi.section}
			onValueChange={(value) => (modelSettingsUi.section = value as SettingsSection)}
			orientation="vertical"
			variant="ghost"
			class="settings-layout"
		>
			<nav class="settings-nav" aria-label="Settings sections">
				<Typography.Metadata class="settings-nav-label">Settings</Typography.Metadata>
				<Tabs.List class="settings-nav-list">
					{#each SECTIONS as section (section.id)}
						<Tabs.Trigger value={section.id}>{section.label}</Tabs.Trigger>
					{/each}
				</Tabs.List>
				{#if config?.configPath}
					<p class="settings-path" title={config.configPath}>{config.configPath}</p>
				{/if}
			</nav>

			<div class="settings-main">
				<header class="settings-head">
					<Modal.Title class="settings-title">{title}</Modal.Title>
					<Modal.Close variant="ghost" size="icon" class="mr-0 ml-auto" aria-label="Close settings" disabled={modelSettingsUi.saving}>
						<X size={16} aria-hidden="true" />
					</Modal.Close>
				</header>

				<ScrollArea class="settings-scroll" showCues={false} aria-label="{title} settings">
					<div class="settings-body">
						{#if modelSettingsUi.error && !config}
							<Alert.Root variant="error">
								<Alert.Title>Could not load settings</Alert.Title>
								<Alert.Description>{modelSettingsUi.error}</Alert.Description>
								<Button variant="outline" class="mt-2 w-fit" onclick={() => void modelSettingsUi.load()}>Retry</Button>
							</Alert.Root>
						{:else if !config || !settingsDraft.seeded}
							<div class="flex flex-col gap-4" role="status" aria-label="Loading settings">
								<Skeleton class="h-4 w-20" />
								<div class="grid grid-cols-2 gap-3"><Skeleton class="h-40 rounded-xl" /><Skeleton class="h-40 rounded-xl" /></div>
								<Skeleton class="h-4 w-20" />
								<Skeleton class="h-64 rounded-xl" />
							</div>
						{:else}
							<Tabs.Content value="models"><SettingsModels /></Tabs.Content>
							<Tabs.Content value="connections"><SettingsConnections /></Tabs.Content>
							<Tabs.Content value="harness"><SettingsHarness /></Tabs.Content>
							<Tabs.Content value="appearance"><SettingsAppearance /></Tabs.Content>
						{/if}
					</div>
				</ScrollArea>

				<footer class="settings-foot">
					{#if saveError}
						<span class="min-w-0 flex-1 truncate text-danger" role="alert">{saveError}</span>
					{:else}
						<span class="min-w-0 flex-1 truncate">Overrides RECODER_REVIEW_* env vars</span>
					{/if}
					<Modal.Close variant="ghost" class="settings-cancel mr-0" disabled={modelSettingsUi.saving}>
						Cancel <kbd class="keycap">esc</kbd>
					</Modal.Close>
					<Button class="settings-save" loading={modelSettingsUi.saving} onclick={() => void save()}>
						Save <kbd class="keycap">⌘↵</kbd>
					</Button>
				</footer>
			</div>
		</Tabs.Root>
	</Modal.Content>
</Modal.Root>
