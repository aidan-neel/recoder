<script lang="ts">
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import Plus from '@lucide/svelte/icons/plus';
	import SlidersHorizontal from '@lucide/svelte/icons/sliders-horizontal';
	import { Button } from '@sivir-ui/svelte/components/button';
	import * as Card from '@sivir-ui/svelte/components/card';
	import * as Collapsible from '@sivir-ui/svelte/components/collapsible';
	import { Input } from '@sivir-ui/svelte/components/input';
	import * as Modal from '@sivir-ui/svelte/components/modal';
	import * as Select from '@sivir-ui/svelte/components/select';
	import { ScrollArea } from '@sivir-ui/svelte/components/scroll-area';
	import { Skeleton } from '@sivir-ui/svelte/components/skeleton';
	import type {
		CodexModel,
		ModelEntry,
		ReviewRole
	} from '@recoder/shared';
	import CodexConnection from './codex-connection.svelte';
	import { MODEL_ROLES, modelSettingsUi } from '$lib/model-settings.svelte';
	import { formatAgentName } from '$lib/threads.svelte';
	import { createNestedEscapeGuard } from '$lib/nested-escape-guard.svelte';
	const connectionEscape = createNestedEscapeGuard(
		['sharedModel', 'usage'],
		() => modelSettingsUi.open
	);
	const roleEscape = createNestedEscapeGuard(
		['model'],
		() => roleOpen
	);

	interface DraftEntry extends ModelEntry {
		newKey?: string;
	}
	const SHARED = '__shared__';
	let entries = $state<DraftEntry[]>([]);
	let sharedId = $state('');
	let roleIds = $state<Partial<Record<ReviewRole, string>>>({});
	let seeded = $state(false);
	let adding = $state(false);
	let draftLabel = $state('');
	let draftModel = $state('');
	let draftBaseUrl = $state('');
	let draftKey = $state('');
	let editingRole = $state<ReviewRole | null>(null);
	let roleOpen = $state(false);
	let draftRoleModel = $state(SHARED);
	let advancedOpen = $state(false);
	const sharedEntry = $derived(entries.find((entry) => entry.id === sharedId));
	const apiEntries = $derived(entries.filter((entry) => entry.provider !== 'codex'));
	const label = (entry: ModelEntry) =>
		entry.provider === 'codex'
			? entry.label.replace(/\s*·\s*subscription$/i, '')
			: entry.label;
	const roleModelLabel = (role: ReviewRole) =>
		entries.find((entry) => entry.id === roleIds[role]);
	/** Specialists overriding the default model — surfaced on the Advanced trigger. */
	const customizedCount = $derived(
		MODEL_ROLES.filter((role) => (roleIds[role] ?? SHARED) !== SHARED).length
	);

	$effect(() => {
		if (
			modelSettingsUi.open &&
			!modelSettingsUi.loading &&
			modelSettingsUi.config &&
			!seeded
		) {
			const config = modelSettingsUi.config;
			entries = config.models.map((entry) => ({
				...entry,
				label: label(entry)
			}));
			sharedId = config.sharedModelId ?? config.models[0]?.id ?? '';
			roleIds = Object.fromEntries(
				MODEL_ROLES.map((role) => [role, config.roles[role] ?? SHARED])
			);
			seeded = true;
		}
		if (!modelSettingsUi.open) {
			seeded = false;
			adding = false;
			roleOpen = false;
			advancedOpen = false;
			draftKey = '';
		}
	});

	async function persist(): Promise<boolean> {
		if (modelSettingsUi.saving) return false;
		const ok = await modelSettingsUi.save({
			models: entries.map((entry) => ({
				id: entry.id,
				provider: entry.provider ?? 'openai-compatible',
				label: entry.label,
				model: entry.model,
				...(entry.baseUrl ? { baseUrl: entry.baseUrl } : {}),
				apiKey: entry.newKey ?? '',
				...(entry.efforts?.length ? { efforts: entry.efforts } : {})
			})),
			sharedModelId: sharedId || null,
			roles: Object.fromEntries(
				MODEL_ROLES.map((role) => [
					role,
					roleIds[role] === SHARED ? '' : (roleIds[role] ?? '')
				])
			)
		});
		if (ok && modelSettingsUi.config)
			entries = modelSettingsUi.config.models.map((entry) => ({
				...entry,
				label: label(entry)
			}));
		return ok;
	}

	function startAdd(): void {
		draftLabel = '';
		draftModel = '';
		draftBaseUrl = '';
		draftKey = '';
		adding = true;
	}

	async function confirmAdd(event: SubmitEvent): Promise<void> {
		event.preventDefault();
		if (modelSettingsUi.saving || !draftLabel.trim() || !draftModel.trim())
			return;
		const id = randomId();
		entries = [
			...entries,
			{
				id,
				provider: 'openai-compatible',
				label: draftLabel.trim(),
				model: draftModel.trim(),
				baseUrl: draftBaseUrl.trim() || null,
				apiKeyPreview: null,
				newKey: draftKey.trim()
			}
		];
		if (!sharedId) sharedId = id;
		adding = false;
		draftKey = '';
		await persist();
	}

	/** Mirror the connected ChatGPT catalog into selectable entries (no manual add). */
	function syncCodexModels(models: CodexModel[]): void {
		const existing = entries.filter((entry) => entry.provider === 'codex');
		const same =
			existing.length === models.length &&
			models.every((model) => {
				const entry = existing.find((item) => item.id === `codex:${model.id}`);
				return entry?.model === model.id;
			});
		if (same) return;
		const others = entries.filter((entry) => entry.provider !== 'codex');
		const next: DraftEntry[] = models.map((model) => ({
			id: `codex:${model.id}`,
			provider: 'codex',
			label: model.label,
			model: model.id,
			baseUrl: null,
			apiKeyPreview: null,
			...(model.efforts?.length ? { efforts: model.efforts } : {})
		}));
		entries = [...others, ...next];
		if (!sharedId || !entries.some((entry) => entry.id === sharedId)) {
			sharedId = next[0]?.id ?? others[0]?.id ?? '';
		}
		void persist();
	}

	/** Drop ChatGPT entries when the subscription disconnects. */
	function clearCodexModels(): void {
		if (!entries.some((entry) => entry.provider === 'codex')) return;
		entries = entries.filter((entry) => entry.provider !== 'codex');
		if (!entries.some((entry) => entry.id === sharedId)) sharedId = entries[0]?.id ?? '';
		void persist();
	}

	function randomId(): string {
		if (
			typeof crypto !== 'undefined' &&
			typeof crypto.randomUUID === 'function'
		)
			return crypto.randomUUID();
		return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
			const r = Math.floor(Math.random() * 16);
			return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
		});
	}

	function editRole(role: ReviewRole): void {
		editingRole = role;
		draftRoleModel = roleIds[role] ?? SHARED;
		roleOpen = true;
	}

	async function saveRole(): Promise<void> {
		if (!editingRole) return;
		roleIds[editingRole] = draftRoleModel;
		if (await persist()) roleOpen = false;
	}

	/** Enter closes the settings (Done) unless focus is on a control or a nested modal is open. */
	function handleEnterDone(event: KeyboardEvent): void {
		if (event.key !== 'Enter' || !modelSettingsUi.open) return;
		if (modelSettingsUi.saving || adding || roleOpen) return;
		if (Object.values(connectionEscape.open).some(Boolean)) return;
		const target = event.target as HTMLElement | null;
		if (
			target?.closest(
				'button, a, input, textarea, select, [role="option"], [role="menuitem"], [role="listbox"]'
			)
		)
			return;
		event.preventDefault();
		modelSettingsUi.hide();
	}
</script>

<svelte:window onkeydown={handleEnterDone} />

<Modal.Root bind:open={modelSettingsUi.open}>
	<Modal.Content
		size="xl"
		class="!max-w-[58rem] !max-h-[min(90dvh,50rem)]"
		surfaceClass="!overflow-hidden"
		allowEscape={!modelSettingsUi.saving && connectionEscape.allowEscape}
		allowClickOutside={!modelSettingsUi.saving}
		showClose={!modelSettingsUi.saving}
	>
		<Modal.Header class="shrink-0">
			<Modal.Title>Connections</Modal.Title>
		</Modal.Header>
		<Modal.Body class="min-h-0">
			{#if modelSettingsUi.loading || !seeded}
				{#if modelSettingsUi.error}
					<p role="alert" class="text-sm text-error">{modelSettingsUi.error}</p>
					<Button
						variant="secondary"
						onclick={() => void modelSettingsUi.load()}>Retry</Button
					>
				{:else}
					<div
						class="grid gap-3"
						role="status"
						aria-label="Loading connections"
					>
						<Skeleton class="h-24 w-full rounded-lg" /><Skeleton
							class="h-40 w-full rounded-lg"
						/>
					</div>
				{/if}
			{:else}
				<ScrollArea
					class="max-h-[min(64dvh,36rem)]"
					showCues={false}
					aria-label="Connection settings"
				>
					<div class="flex flex-col gap-6 p-0.5">
						<section
							class="flex min-w-0 flex-col gap-2.5"
							aria-label="Model providers"
						>
							<h3
								class="m-0 px-1 text-[13px] font-medium text-foreground-muted"
								>Providers</h3
							>
							<Card.Root class="p-0">
								<div class="p-4">
									<CodexConnection
										active={modelSettingsUi.open}
										onSync={syncCodexModels}
										onClear={clearCodexModels}
										disabled={modelSettingsUi.saving}
										bind:usageOpen={connectionEscape.open.usage}
									/>
								</div>
								<div class="border-t border-border p-4">
									<div
										class="flex items-center justify-between gap-3"
									>
										<span class="text-sm font-medium"
											>API providers</span
										>
										<Modal.Root bind:open={adding}>
											<Modal.Trigger
												variant="outline"
												disabled={modelSettingsUi.saving}
												onclick={startAdd}
												><Plus size={14} aria-hidden="true" />Add
												provider</Modal.Trigger
											>
											<Modal.Content size="lg">
												<Modal.Header
													><Modal.Title
														>Add API provider</Modal.Title
													></Modal.Header
												>
												<form
													id="add-model-provider"
													onsubmit={confirmAdd}
													class="grid gap-4"
												>
													<Input
														label="Name"
														placeholder="OpenRouter"
														required
														bind:value={draftLabel}
													/>
													<Input
														label="Model ID"
														placeholder="openai/gpt-5"
														required
														bind:value={draftModel}
													/>
													<Input
														label="Base URL"
														type="url"
														placeholder="https://api.openai.com/v1"
														bind:value={draftBaseUrl}
													/>
													<Input
														label="API key"
														type="password"
														autocomplete="off"
														placeholder="Optional for local providers"
														bind:value={draftKey}
													/>
												</form>
												<Modal.Footer
													><Modal.Close>Cancel</Modal.Close
													><Button
														type="submit"
														form="add-model-provider"
														>Add provider</Button
													></Modal.Footer
												>
											</Modal.Content>
										</Modal.Root>
									</div>
									{#if apiEntries.length > 0}
										<ul
											class="m-0 mt-3 flex list-none flex-col gap-2 border-t border-border p-0 pt-3"
										>
											{#each apiEntries as entry (entry.id)}
												<li
													class="flex min-w-0 items-baseline justify-between gap-3"
												>
													<span
														class="min-w-0 truncate text-[13px] font-medium"
														>{label(entry)}</span
													>
													<span
														class="shrink-0 truncate font-mono text-xs text-foreground-muted"
														>{entry.model}</span
													>
												</li>
											{/each}
										</ul>
									{:else}
										<p
											class="m-0 mt-3 border-t border-border pt-3 text-[13px] text-foreground-muted"
										>
											No API providers yet.
										</p>
									{/if}
								</div>
							</Card.Root>
						</section>
						<section
							class="flex min-w-0 flex-col gap-2.5"
							aria-label="Reviewer roles"
						>
							<h3
								class="m-0 px-1 text-[13px] font-medium text-foreground-muted"
								>Reviewers</h3
							>
							<Card.Root class="p-0">
								<div class="flex flex-col gap-2 p-4">
									<span class="text-sm font-medium"
										>Default model</span
									>
									<Select.Root
										value={sharedId}
										bind:open={connectionEscape.open.sharedModel}
									>
										<Select.Trigger
											variant="outline"
											class="w-full justify-between"
											disabled={!entries.length ||
												modelSettingsUi.saving}
											aria-label="Default model"
											><span class="truncate"
												>{sharedEntry
													? label(sharedEntry)
													: 'Use environment settings'}</span
											></Select.Trigger
										>
										<Select.Content class="max-h-64"
											>{#each entries as entry (entry.id)}<Select.Item
													value={entry.id}
													onclick={() => {
														sharedId = entry.id;
														void persist();
													}}>{label(entry)}</Select.Item
												>{/each}</Select.Content
										>
									</Select.Root>
								</div>
								<Collapsible.Root bind:open={advancedOpen}>
								<Collapsible.Trigger
									class="flex w-full items-center justify-between gap-2 border-t border-border px-4 py-2.5 text-left text-sm font-medium transition-colors hover:bg-secondary"
								>
									<span>Advanced</span>
									<span
										class="flex items-center gap-2 text-xs font-normal text-foreground-muted"
									>
										{#if customizedCount > 0}
											<span>{customizedCount} customized</span>
										{/if}
										<ChevronDown
											size={13}
											aria-hidden="true"
											class="transition-transform {advancedOpen
												? 'rotate-180'
												: ''}"
										/>
									</span>
								</Collapsible.Trigger>
								<Collapsible.Content>
									<ul
										class="m-0 flex list-none flex-col divide-y divide-border border-t border-border p-0"
										aria-label="Reviewer role settings"
									>
										{#each MODEL_ROLES as role (role)}
											{@const override = roleModelLabel(role)}
											<li
												class="flex items-center gap-2 px-4 py-2.5"
											>
												<div class="min-w-0 flex-1">
													<div
														class="truncate text-sm font-medium"
													>
														{formatAgentName(role)}
													</div>
													<div
														class="truncate text-xs text-foreground-muted"
														title={override
															? label(override)
															: 'Uses default model'}
													>
														{override
															? label(override)
															: 'Default model'}
													</div>
												</div>
												<Button
													variant="ghost"
													size="icon"
													class="size-9 shrink-0"
													disabled={modelSettingsUi.saving}
													aria-label="Customize {formatAgentName(
														role
													)}"
													onclick={() => editRole(role)}
													><SlidersHorizontal
														size={14}
														aria-hidden="true"
													/></Button
												>
											</li>
										{/each}
									</ul>
								</Collapsible.Content>
							</Collapsible.Root>
							</Card.Root>
						</section>
					</div>
				</ScrollArea>
				<Modal.Root bind:open={roleOpen}>
					<Modal.Content
						size="lg"
						allowEscape={!modelSettingsUi.saving && roleEscape.allowEscape}
						allowClickOutside={!modelSettingsUi.saving}
						showClose={!modelSettingsUi.saving}
					>
					<Modal.Header
							><Modal.Title
								>{editingRole ? formatAgentName(editingRole) : 'Role'} settings</Modal.Title
							></Modal.Header
						>
						<Modal.Body class="gap-4">
							<div class="grid gap-2">
								<span class="text-sm font-medium">Model</span><Select.Root
									value={draftRoleModel}
									bind:open={roleEscape.open.model}
									><Select.Trigger
										variant="outline"
										aria-label="Role model"
										disabled={modelSettingsUi.saving}
										class="w-full justify-between"
										><span class="truncate"
											>{draftRoleModel === SHARED
												? 'Use default model'
												: (entries.find((entry) => entry.id === draftRoleModel)
														?.label ?? 'Use default model')}</span
										></Select.Trigger
									><Select.Content class="max-h-64"
										><Select.Item
											value={SHARED}
											onclick={() => (draftRoleModel = SHARED)}
											>Use default model</Select.Item
										>{#each entries as entry (entry.id)}<Select.Item
												value={entry.id}
												onclick={() => (draftRoleModel = entry.id)}
												>{label(entry)}</Select.Item
											>{/each}</Select.Content
									>						</Select.Root
								>
							</div>
							{#if modelSettingsUi.error}<p
									role="alert"
									class="m-0 text-sm text-error"
								>
									{modelSettingsUi.error}
								</p>{/if}
						</Modal.Body>
						<Modal.Footer
							><Modal.Close disabled={modelSettingsUi.saving}
								>Cancel</Modal.Close
							><Button
								loading={modelSettingsUi.saving}
								onclick={() => void saveRole()}>Save role</Button
							></Modal.Footer
						>
					</Modal.Content>
				</Modal.Root>
			{/if}
		</Modal.Body>
		<Modal.Footer>
			<div
				class="flex min-w-0 flex-1 items-center gap-2 pl-3 text-xs text-foreground-muted"
				role="status"
			>
				{#if modelSettingsUi.error && seeded}<span class="text-error"
						>Changes not saved.</span
					><Button variant="ghost" onclick={() => void persist()}
						>Retry</Button
					>
				{:else if modelSettingsUi.saving}Saving changes...
				{:else}Changes save automatically{/if}
			</div>
			<Modal.Close variant="primary" disabled={modelSettingsUi.saving}>Done</Modal.Close>
		</Modal.Footer>
	</Modal.Content>
</Modal.Root>
