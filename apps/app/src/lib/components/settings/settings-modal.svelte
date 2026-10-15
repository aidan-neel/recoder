<script lang="ts">
	import { untrack } from 'svelte';
	import Check from '@lucide/svelte/icons/check';
	import Search from '@lucide/svelte/icons/search';
	import X from '@lucide/svelte/icons/x';
	import { Button } from '@sivir-ui/svelte/components/button';
	import { Input } from '@sivir-ui/svelte/components/input';
	import * as Modal from '@sivir-ui/svelte/components/modal';
	import { ScrollArea } from '@sivir-ui/svelte/components/scroll-area';
	import { Spinner } from '@sivir-ui/svelte/components/spinner';
	import * as Tabs from '@sivir-ui/svelte/components/tabs';
	import * as Typography from '@sivir-ui/svelte/components/typography';
	import SettingsAgent from '$web/components/settings/settings-agent.svelte';
	import SettingsAppearance from '$web/components/settings/settings-appearance.svelte';
	import SettingsConnections from '$web/components/settings/settings-connections.svelte';
	import SettingsGuidelines from '$web/components/settings/settings-guidelines.svelte';
	import SettingsHarness from '$web/components/settings/settings-harness.svelte';
	import SettingsLoadError from '$web/components/settings/settings-load-error.svelte';
	import SettingsSkeleton from '$web/components/settings/settings-skeleton.svelte';
	import { agent } from '$web/settings/agent.svelte';
	import { modelSettingsUi, type SettingsSection } from '$web/settings/model-settings.svelte';
	import { settingsDraft } from '$web/settings/settings-draft.svelte';
	import { errorToast } from '$web/shell/notify';
	import { autosave } from '$lib/settings/autosave.svelte';
	import { SECTIONS, searchSections } from '$lib/settings/sections';

	const VIEWS = {
		models: SettingsAgent,
		connections: SettingsConnections,
		harness: SettingsHarness,
		guidelines: SettingsGuidelines,
		appearance: SettingsAppearance
	};

	let query = $state('');

	/** The fetch this open started has landed. Later reloads (after adding a provider) keep the section mounted. */
	let fresh = $state(false);

	const section = $derived(SECTIONS.find((item) => item.id === modelSettingsUi.section) ?? SECTIONS[0]);
	const View = $derived(VIEWS[section.id]);
	const matches = $derived(searchSections(query));
	const config = $derived(modelSettingsUi.config);

	/** Agent and Review harness edit the draft, so they wait for the saved config; the rest render at once. */
	const drafted = $derived(section.id === 'models' || section.id === 'harness');
	const agentPending = $derived(!agent.error && (agent.statuses === null || agent.providers === null));
	const failed = $derived(drafted && !!modelSettingsUi.error && !config);

	const pending = $derived(
		drafted && (!fresh || !config || !settingsDraft.seeded || (section.id === 'models' && agentPending))
	);

	/** Each open starts from the saved config; the fetch `show()` starts must land first, so edits never sit on a cached copy. */
	$effect(() => {
		if (!modelSettingsUi.open) return;

		untrack(() => {
			query = '';
			fresh = false;
			settingsDraft.reset();
			void agent.load();
		});
	});

	$effect(() => {
		if (modelSettingsUi.open && !modelSettingsUi.loading) fresh = true;
	});

	$effect(() => {
		if (fresh && config && !settingsDraft.seeded) untrack(() => settingsDraft.seed(config));
	});

	/** Every edit restarts the wait before saving. */
	$effect(() => {
		if (autosave.dirty) untrack(() => autosave.schedule());
	});

	function select(id: SettingsSection): void {
		modelSettingsUi.section = id;
	}

	/** Enter in search opens the first match. */
	function onSearchKey(event: KeyboardEvent): void {
		if (event.key !== 'Enter' || matches.length === 0) return;

		event.preventDefault();
		select(matches[0].id);
	}

	/** Closing saves anything still waiting; a failure then can only be a toast. */
	function onOpenChange(open: boolean): void {
		if (open || !autosave.dirty) return;

		void autosave.save().then((ok) => ok || errorToast('Settings were not saved', autosave.error ?? undefined));
	}
</script>

<Modal.Root bind:open={modelSettingsUi.open} {onOpenChange}>
	<Modal.Content
		size="xl"
		class="settings-modal app-settings"
		surfaceClass="settings-surface"
		showClose={false}
		aria-label="Settings"
	>
		<Tabs.Root
			value={section.id}
			onValueChange={(value) => select(value as SettingsSection)}
			orientation="vertical"
			variant="ghost"
			class="settings-layout"
		>
			<nav class="settings-nav" aria-label="Settings sections">
				<Input placeholder="Search" aria-label="Search settings" bind:value={query} onkeydown={onSearchKey}>
					{#snippet leading()}<Search size={15} aria-hidden="true" />{/snippet}
				</Input>
				<Typography.Metadata class="settings-nav-label">Settings</Typography.Metadata>
				<Tabs.List class="settings-nav-list">
					{#each matches as item (item.id)}
						{@const Icon = item.icon}
						<Tabs.Trigger value={item.id}>
							<Icon size={16} strokeWidth={1.75} aria-hidden="true" />
							{item.label}
						</Tabs.Trigger>
					{/each}
				</Tabs.List>
				{#if matches.length === 0}
					<p class="settings-nav-empty">No settings match “{query.trim()}”</p>
				{/if}
				{#if config?.configPath}
					<p class="settings-path" title="Saved settings override RECODER_REVIEW_* env vars">{config.configPath}</p>
				{/if}
			</nav>

			<div class="settings-main">
				<header class="settings-head">
					<Modal.Title class="settings-title">{section.label}</Modal.Title>
					<span class="settings-status" role="status" data-status={autosave.status}>
						{#if autosave.status === 'saving'}
							<Spinner size={12} /> Saving
						{:else if autosave.status === 'saved'}
							<Check size={13} strokeWidth={2.25} class="text-ok" aria-hidden="true" /> Saved
						{:else if autosave.status === 'failed'}
							<span class="truncate text-danger" title={autosave.error}>Not saved</span>
							<Button variant="ghost" class="provider-link" onclick={() => void autosave.save()}>Retry</Button>
						{/if}
					</span>
					<Modal.Close variant="ghost" size="icon" class="mr-0" aria-label="Close settings">
						<X size={16} aria-hidden="true" />
					</Modal.Close>
				</header>

				<ScrollArea class="settings-scroll" showCues={false} aria-label="{section.label} settings">
					<div class="settings-body">
						<Tabs.Content value={section.id}>
							{#if failed}
								<SettingsLoadError />
							{:else if pending}
								<SettingsSkeleton section={section.id} />
							{:else}
								<View />
							{/if}
						</Tabs.Content>
					</div>
				</ScrollArea>
			</div>
		</Tabs.Root>
	</Modal.Content>
</Modal.Root>
