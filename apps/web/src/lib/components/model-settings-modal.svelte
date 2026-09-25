<script lang="ts">
	import X from '@lucide/svelte/icons/x';
	import * as Alert from '@sivir-ui/svelte/components/alert';
	import { Button } from '@sivir-ui/svelte/components/button';
	import * as Card from '@sivir-ui/svelte/components/card';
	import * as Modal from '@sivir-ui/svelte/components/modal';
	import { ScrollArea } from '@sivir-ui/svelte/components/scroll-area';
	import * as Tabs from '@sivir-ui/svelte/components/tabs';
	import * as Typography from '@sivir-ui/svelte/components/typography';
	import SettingsAppearance from './settings-appearance.svelte';
	import SettingsConnections from './settings-connections.svelte';
	import SettingsGuidelines from './settings-guidelines.svelte';
	import SettingsHarness from './settings-harness.svelte';
	import SettingsModels from './settings-models.svelte';
	import Skeleton from './ui/skeleton.svelte';
	import { modelSettingsUi, type SettingsSection } from '$lib/model-settings.svelte';
	import { settingsDraft } from '$lib/settings-draft.svelte';
	import { guidelinesStore } from '$lib/guidelines.svelte';

	const SECTIONS: { id: SettingsSection; label: string }[] = [
		{ id: 'models', label: 'Models' },
		{ id: 'connections', label: 'Connections' },
		{ id: 'harness', label: 'Review harness' },
		{ id: 'guidelines', label: 'Guidelines' },
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
		// The guidelines editor stacks on top and owns ⌘↵ while it is open.
		if (!modelSettingsUi.open || guidelinesStore.editing || modelSettingsUi.section === 'guidelines' || event.key !== 'Enter' || !(event.metaKey || event.ctrlKey)) return;
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
							<!-- Built from the real settings classes so rows land where the loaded section puts them. -->
							<div class="flex flex-col gap-6" role="status" aria-label="Loading settings">
								{#if modelSettingsUi.section === 'models'}
									<section class="settings-section" aria-hidden="true">
										<Typography.H3 class="settings-label">Provider</Typography.H3>
										<div class="provider-grid">
											{#each [0, 1] as i (i)}
												<Card.Root class="provider-card">
													<div class="flex h-5 items-center gap-2"><Skeleton class="size-1.5 !rounded-full" /><Skeleton class="h-3.5 w-24" /><Skeleton class="ms-auto h-3 w-12" /></div>
													<Skeleton class="h-3 w-3/4" />
													<Skeleton class="h-3 w-1/2" />
												</Card.Root>
											{/each}
										</div>
									</section>
								{/if}
								<section class="settings-section" aria-hidden="true">
									{#if modelSettingsUi.section === 'models'}<Typography.H3 class="settings-label">Roles</Typography.H3>{:else}<div class="flex h-[17.5px] items-center"><Skeleton class="h-3 w-24" /></div>{/if}
									<Card.Root class="settings-list">
										{#each [0, 1, 2, 3, 4] as i (i)}
											<div class="settings-row">
												<div class="flex min-w-0 flex-1 flex-col gap-1.5"><Skeleton class="h-3" w={[28, 36, 24, 32, 26][i]} unit="%" /><Skeleton class="h-2.5" w={[44, 38, 30, 34, 40][i]} unit="%" /></div>
												<Skeleton class="h-3 w-24" />
											</div>
										{/each}
									</Card.Root>
								</section>
							</div>
						{:else}
							<Tabs.Content value="models"><SettingsModels /></Tabs.Content>
							<Tabs.Content value="connections"><SettingsConnections /></Tabs.Content>
							<Tabs.Content value="harness"><SettingsHarness /></Tabs.Content>
							<Tabs.Content value="guidelines"><SettingsGuidelines /></Tabs.Content>
							<Tabs.Content value="appearance"><SettingsAppearance /></Tabs.Content>
						{/if}
					</div>
				</ScrollArea>

				<footer class="settings-foot">
					{#if saveError}
						<span class="min-w-0 flex-1 truncate text-danger" role="alert">{saveError}</span>
					{:else}
						<span class="min-w-0 flex-1 truncate">{modelSettingsUi.section === 'guidelines' ? 'Guidelines save from their own editor' : 'Overrides RECODER_REVIEW_* env vars'}</span>
					{/if}
					{#if modelSettingsUi.section === 'guidelines'}
						<Modal.Close variant="ghost" class="settings-cancel mr-0">
							Close <kbd class="keycap">esc</kbd>
						</Modal.Close>
					{:else}
						<Modal.Close variant="ghost" class="settings-cancel mr-0" disabled={modelSettingsUi.saving}>
							Cancel <kbd class="keycap">esc</kbd>
						</Modal.Close>
						<Button class="settings-save" loading={modelSettingsUi.saving} onclick={() => void save()}>
							Save <kbd class="keycap">⌘↵</kbd>
						</Button>
					{/if}
				</footer>
			</div>
		</Tabs.Root>
	</Modal.Content>
</Modal.Root>
