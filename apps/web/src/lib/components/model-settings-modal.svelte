<script lang="ts">
	import Plus from '@lucide/svelte/icons/plus';
	import X from '@lucide/svelte/icons/x';
	import SlidersHorizontal from '@lucide/svelte/icons/sliders-horizontal';
	import { Button } from '@sivir-ui/svelte/components/button';
	import { Input } from '@sivir-ui/svelte/components/input';
	import * as Modal from '@sivir-ui/svelte/components/modal';
	import * as Select from '@sivir-ui/svelte/components/select';
	import { ScrollArea } from '@sivir-ui/svelte/components/scroll-area';
	import { Skeleton } from '@sivir-ui/svelte/components/skeleton';
	import type { CodexModel, ModelEntry, ReasoningEffort, ReviewRole } from '@recoder/shared';
	import CodexConnection from './codex-connection.svelte';
	import { MODEL_ROLES, modelSettingsUi } from '$lib/model-settings.svelte';
	import { formatAgentName } from '$lib/threads.svelte';

	interface DraftEntry extends ModelEntry { newKey?: string }
	const SHARED = '__shared__';
	const EFFORTS: ReasoningEffort[] = ['low', 'medium', 'high'];
	let entries = $state<DraftEntry[]>([]);
	let sharedId = $state('');
	let roleIds = $state<Partial<Record<ReviewRole, string>>>({});
	let roleEfforts = $state<Partial<Record<ReviewRole, ReasoningEffort>>>({});
	let seeded = $state(false);
	let adding = $state(false);
	let draftLabel = $state('');
	let draftModel = $state('');
	let draftBaseUrl = $state('');
	let draftKey = $state('');
	let editingRole = $state<ReviewRole | null>(null);
	let roleOpen = $state(false);
	let draftRoleModel = $state(SHARED);
	let draftEffort = $state<ReasoningEffort | undefined>();
	const sharedEntry = $derived(entries.find((entry) => entry.id === sharedId));
	const label = (entry: ModelEntry) => entry.provider === 'codex'
		? entry.label.replace(/\s*·\s*subscription$/i, '') : entry.label;
	const effortLabel = (effort?: ReasoningEffort) => effort
		? effort[0].toUpperCase() + effort.slice(1) : 'Default';
	const roleModelLabel = (role: ReviewRole) => entries.find((entry) => entry.id === roleIds[role]);

	$effect(() => {
		if (modelSettingsUi.open && !modelSettingsUi.loading && modelSettingsUi.config && !seeded) {
			const config = modelSettingsUi.config;
			entries = config.models.map((entry) => ({ ...entry, label: label(entry) }));
			sharedId = config.sharedModelId ?? config.models[0]?.id ?? '';
			roleIds = Object.fromEntries(MODEL_ROLES.map((role) => [role, config.roles[role] ?? SHARED]));
			roleEfforts = { ...config.roleEfforts };
			seeded = true;
		}
		if (!modelSettingsUi.open) {
			seeded = false;
			adding = false;
			roleOpen = false;
			draftKey = '';
		}
	});

	async function persist(): Promise<boolean> {
		if (modelSettingsUi.saving) return false;
		const ok = await modelSettingsUi.save({
			models: entries.map((entry) => ({
				id: entry.id, provider: entry.provider ?? 'openai-compatible',
				label: entry.label, model: entry.model,
				...(entry.baseUrl ? { baseUrl: entry.baseUrl } : {}), apiKey: entry.newKey ?? ''
			})),
			sharedModelId: sharedId || null,
			roles: Object.fromEntries(MODEL_ROLES.map((role) => [role, roleIds[role] === SHARED ? '' : roleIds[role] ?? ''])),
			roleEfforts
		});
		if (ok && modelSettingsUi.config) entries = modelSettingsUi.config.models.map((entry) => ({ ...entry, label: label(entry) }));
		return ok;
	}

	function startAdd(): void {
		draftLabel = ''; draftModel = ''; draftBaseUrl = ''; draftKey = '';
		adding = true;
	}

	async function confirmAdd(event: SubmitEvent): Promise<void> {
		event.preventDefault();
		if (modelSettingsUi.saving || !draftLabel.trim() || !draftModel.trim()) return;
		const id = randomId();
		entries = [...entries, { id, provider: 'openai-compatible', label: draftLabel.trim(), model: draftModel.trim(), baseUrl: draftBaseUrl.trim() || null, apiKeyPreview: null, newKey: draftKey.trim() }];
		if (!sharedId) sharedId = id;
		adding = false;
		draftKey = '';
		await persist();
	}

	function removeEntry(id: string): void {
		entries = entries.filter((entry) => entry.id !== id);
		if (sharedId === id) sharedId = entries[0]?.id ?? '';
		for (const role of MODEL_ROLES) if (roleIds[role] === id) roleIds[role] = SHARED;
		void persist();
	}

	function addCodexModel(model: CodexModel): void {
		const existing = entries.find((entry) => entry.provider === 'codex' && entry.model === model.id);
		if (existing) sharedId = existing.id;
		else {
			sharedId = randomId();
			entries = [...entries, { id: sharedId, provider: 'codex', label: model.label, model: model.id, baseUrl: null, apiKeyPreview: null }];
		}
		void persist();
	}

	function randomId(): string {
		if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
		return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
			const r = Math.floor(Math.random() * 16);
			return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
		});
	}

	function editRole(role: ReviewRole): void {
		editingRole = role;
		draftRoleModel = roleIds[role] ?? SHARED;
		draftEffort = roleEfforts[role];
		roleOpen = true;
	}

	async function saveRole(): Promise<void> {
		if (!editingRole) return;
		roleIds[editingRole] = draftRoleModel;
		if (draftEffort) roleEfforts[editingRole] = draftEffort;
		if (await persist()) roleOpen = false;
	}
</script>

<Modal.Root bind:open={modelSettingsUi.open}>
	<Modal.Content size="xl" class="!max-w-[52rem] !max-h-[min(88dvh,48rem)]" surfaceClass="!overflow-hidden" allowEscape={!modelSettingsUi.saving} allowClickOutside={!modelSettingsUi.saving} showClose={!modelSettingsUi.saving}>
		<Modal.Header class="shrink-0">
			<Modal.Title>Connections</Modal.Title>
			<Modal.Description>Connect model providers and choose how each reviewer runs.</Modal.Description>
		</Modal.Header>
		<Modal.Body class="min-h-0">
			{#if modelSettingsUi.loading || !seeded}
				{#if modelSettingsUi.error}
					<p role="alert" class="text-sm text-error">{modelSettingsUi.error}</p>
					<Button variant="secondary" onclick={() => void modelSettingsUi.load()}>Retry</Button>
				{:else}
					<div class="grid gap-3" role="status" aria-label="Loading connections">
						<Skeleton class="h-24 w-full rounded-lg" /><Skeleton class="h-40 w-full rounded-lg" />
					</div>
				{/if}
			{:else}
				<ScrollArea class="max-h-[min(62dvh,34rem)]" aria-label="Connection settings" tabindex="0">
					<div class="grid gap-7 p-0.5 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
						<section class="flex min-w-0 flex-col gap-6" aria-label="Model providers">
							<CodexConnection active={modelSettingsUi.open} onAdd={addCodexModel} disabled={modelSettingsUi.saving} />
							<div class="flex flex-wrap items-center justify-between gap-3">
								<div><h3 class="m-0 text-sm font-medium">API provider</h3><p class="m-0 mt-1 text-xs text-foreground-muted">OpenAI-compatible endpoints</p></div>
								<Modal.Root bind:open={adding}>
									<Modal.Trigger variant="outline" size="sm" disabled={modelSettingsUi.saving} onclick={startAdd}><Plus size={14} aria-hidden="true" />Add provider</Modal.Trigger>
									<Modal.Content size="lg">
										<Modal.Header><Modal.Title>Add API provider</Modal.Title><Modal.Description>Connect a model using an OpenAI-compatible API. Credentials stay on this server.</Modal.Description></Modal.Header>
										<form id="add-model-provider" onsubmit={confirmAdd} class="grid gap-4">
											<Input label="Name" placeholder="OpenRouter" required bind:value={draftLabel} />
											<Input label="Model ID" placeholder="openai/gpt-5" required bind:value={draftModel} />
											<Input label="Base URL" type="url" placeholder="https://api.openai.com/v1" bind:value={draftBaseUrl} />
											<Input label="API key" type="password" autocomplete="off" placeholder="Optional for local providers" bind:value={draftKey} />
										</form>
										<Modal.Footer><Modal.Close>Cancel</Modal.Close><Button type="submit" form="add-model-provider">Add provider</Button></Modal.Footer>
									</Modal.Content>
								</Modal.Root>
							</div>
							<div class="flex min-w-0 flex-col gap-2">
								<h3 class="m-0 text-sm font-medium">Available models <span class="ml-1 text-foreground-muted">{entries.length}</span></h3>
								{#if !entries.length}<p class="m-0 text-sm text-foreground-muted">Sign in or add an API provider to get started. Environment settings still apply.</p>{/if}
								<ScrollArea class="max-h-48" aria-label="Available models" tabindex="0">
									<div class="flex flex-col gap-1">
										{#each entries as entry (entry.id)}
											<div class="flex min-w-0 items-center gap-2 rounded-md bg-secondary/40 px-3 py-2">
												<div class="min-w-0 flex-1"><div class="truncate text-sm font-medium" title={label(entry)}>{label(entry)}</div><div class="truncate text-xs text-foreground-muted" title={entry.model}>{entry.provider === 'codex' ? 'ChatGPT' : entry.baseUrl || 'OpenAI'}{entry.id === sharedId ? ' · Default' : ''}</div></div>
												<Button variant="ghost" size="icon" class="size-8 shrink-0" disabled={modelSettingsUi.saving} aria-label="Remove {label(entry)}" onclick={() => removeEntry(entry.id)}><X size={14} aria-hidden="true" /></Button>
											</div>
										{/each}
									</div>
								</ScrollArea>
							</div>
						</section>
						<section class="flex min-w-0 flex-col gap-4" aria-label="Reviewer roles">
							<div class="flex flex-col gap-2">
								<h3 class="m-0 text-sm font-medium">Default model</h3>
								<Select.Root value={sharedId}>
									<Select.Trigger variant="outline" class="w-full justify-between" disabled={!entries.length || modelSettingsUi.saving} aria-label="Default model"><span class="truncate">{sharedEntry ? label(sharedEntry) : 'Use environment settings'}</span></Select.Trigger>
									<Select.Content class="max-h-64">{#each entries as entry (entry.id)}<Select.Item value={entry.id} onclick={() => { sharedId = entry.id; void persist(); }}>{label(entry)}</Select.Item>{/each}</Select.Content>
								</Select.Root>
							</div>
							<div class="flex items-center justify-between gap-2"><h3 class="m-0 text-sm font-medium">Roles</h3><span class="text-xs text-foreground-muted">Reasoning effort</span></div>
							<ScrollArea class="max-h-[22rem]" aria-label="Reviewer role settings" tabindex="0">
								<div class="flex flex-col gap-1">
									{#each MODEL_ROLES as role (role)}
										{@const override = roleModelLabel(role)}
										<div class="flex items-center gap-2 py-2">
											<div class="min-w-0 flex-1"><div class="text-sm font-medium">{formatAgentName(role)}</div><div class="truncate text-xs text-foreground-muted" title={override ? label(override) : 'Uses default model'}>{override ? label(override) : 'Default model'}</div></div>
											<Select.Root value={roleEfforts[role] ?? 'default'}>
												<Select.Trigger variant="ghost" size="sm" class="w-24 shrink-0 justify-between" disabled={modelSettingsUi.saving} aria-label="{formatAgentName(role)} reasoning effort">{effortLabel(roleEfforts[role])}</Select.Trigger>
												<Select.Content>{#each EFFORTS as effort}<Select.Item value={effort} onclick={() => { roleEfforts[role] = effort; void persist(); }}>{effortLabel(effort)}</Select.Item>{/each}</Select.Content>
											</Select.Root>
											<Button variant="ghost" size="icon" class="size-8 shrink-0" disabled={modelSettingsUi.saving} aria-label="Customize {formatAgentName(role)}" onclick={() => editRole(role)}><SlidersHorizontal size={14} aria-hidden="true" /></Button>
										</div>
									{/each}
								</div>
							</ScrollArea>
						</section>
					</div>
				</ScrollArea>
				<Modal.Root bind:open={roleOpen}>
					<Modal.Content size="lg" allowEscape={!modelSettingsUi.saving} allowClickOutside={!modelSettingsUi.saving} showClose={!modelSettingsUi.saving}>
						<Modal.Header><Modal.Title>{editingRole ? formatAgentName(editingRole) : 'Role'} settings</Modal.Title><Modal.Description>Override the default model for this role.</Modal.Description></Modal.Header>
						<Modal.Body class="gap-4">
							<div class="grid gap-2"><span class="text-sm font-medium">Model</span><Select.Root value={draftRoleModel}><Select.Trigger variant="outline" aria-label="Role model" disabled={modelSettingsUi.saving} class="w-full justify-between"><span class="truncate">{draftRoleModel === SHARED ? 'Use default model' : entries.find((entry) => entry.id === draftRoleModel)?.label ?? 'Use default model'}</span></Select.Trigger><Select.Content class="max-h-64"><Select.Item value={SHARED} onclick={() => draftRoleModel = SHARED}>Use default model</Select.Item>{#each entries as entry (entry.id)}<Select.Item value={entry.id} onclick={() => draftRoleModel = entry.id}>{label(entry)}</Select.Item>{/each}</Select.Content></Select.Root></div>
							<div class="grid gap-2"><span class="text-sm font-medium">Reasoning effort</span><Select.Root value={draftEffort ?? 'default'}><Select.Trigger variant="outline" aria-label="Role reasoning effort" disabled={modelSettingsUi.saving} class="w-full justify-between">{effortLabel(draftEffort)}</Select.Trigger><Select.Content>{#each EFFORTS as effort}<Select.Item value={effort} onclick={() => draftEffort = effort}>{effortLabel(effort)}</Select.Item>{/each}</Select.Content></Select.Root><p class="m-0 text-xs text-foreground-muted">Higher effort can improve complex reviews, but takes longer and uses more tokens. Default leaves effort to the provider (low for ChatGPT).</p></div>
							{#if modelSettingsUi.error}<p role="alert" class="m-0 text-sm text-error">{modelSettingsUi.error}</p>{/if}
						</Modal.Body>
						<Modal.Footer><Modal.Close disabled={modelSettingsUi.saving}>Cancel</Modal.Close><Button loading={modelSettingsUi.saving} onclick={() => void saveRole()}>Save role</Button></Modal.Footer>
					</Modal.Content>
				</Modal.Root>
			{/if}
		</Modal.Body>
		<Modal.Footer>
			<div class="flex min-w-0 flex-1 items-center gap-2 text-xs text-foreground-muted" role="status">
				{#if modelSettingsUi.error && seeded}<span class="text-error">Changes not saved.</span><Button variant="ghost" size="sm" onclick={() => void persist()}>Retry</Button>
				{:else if modelSettingsUi.saving}Saving changes...
				{:else}Changes save automatically{/if}
			</div>
			<Modal.Close disabled={modelSettingsUi.saving}>Done</Modal.Close>
		</Modal.Footer>
	</Modal.Content>
</Modal.Root>
