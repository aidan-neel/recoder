<script lang="ts">
	import Plus from '@lucide/svelte/icons/plus';
	import X from '@lucide/svelte/icons/x';
	import { Button } from '@sivir-ui/svelte/components/button';
	import * as Collapsible from '@sivir-ui/svelte/components/collapsible';
	import { Input } from '@sivir-ui/svelte/components/input';
	import * as Modal from '@sivir-ui/svelte/components/modal';
	import * as Select from '@sivir-ui/svelte/components/select';
	import Shortcut from '@sivir-ui/svelte/components/shortcut';
	import { Skeleton } from '@sivir-ui/svelte/components/skeleton';
	import type { ModelEntry } from '@recoder/shared';
	import { MODEL_ROLES, modelSettingsUi } from '$lib/model-settings.svelte';

	interface DraftEntry extends ModelEntry {
		/** Key for brand-new entries (never sent for existing ones). */
		newKey: string;
		/** True until the entry has been saved to the server once. */
		isNew: boolean;
	}

	const SHARED_SENTINEL = '__shared__';

	let entries = $state<DraftEntry[]>([]);
	let sharedId = $state('');
	let roleIds = $state<Record<string, string>>({
		security: SHARED_SENTINEL,
		perf: SHARED_SENTINEL,
		correctness: SHARED_SENTINEL,
		docs: SHARED_SENTINEL
	});
	let seeded = $state(false);

	let adding = $state(false);
	let draftLabel = $state('');
	let draftModel = $state('');
	let draftBaseUrl = $state('');
	let draftKey = $state('');

	const hasEntries = $derived(entries.length > 0);
	const sharedEntry = $derived(entries.find((e) => e.id === sharedId));
	const roleLabel = (role: string) => {
		const id = roleIds[role];
		if (!id || id === SHARED_SENTINEL) return 'Use shared';
		return entries.find((e) => e.id === id)?.label ?? 'Use shared';
	};

	// Seed the form from the loaded config (once per open).
	$effect(() => {
		if (modelSettingsUi.open && modelSettingsUi.config && !seeded) {
			const config = modelSettingsUi.config;
			entries = config.models.map((e) => ({ ...e, newKey: '', isNew: false }));
			sharedId = config.sharedModelId ?? config.models[0]?.id ?? '';
			for (const role of MODEL_ROLES) {
				roleIds[role] = config.roles[role] ?? SHARED_SENTINEL;
			}
			adding = false;
			seeded = true;
		}
		if (!modelSettingsUi.open) seeded = false;
	});

	function startAdd(): void {
		draftLabel = '';
		draftModel = '';
		draftBaseUrl = '';
		draftKey = '';
		adding = true;
	}

	function confirmAdd(): void {
		if (!draftLabel.trim() || !draftModel.trim()) return;
		const entry: DraftEntry = {
			id: crypto.randomUUID(),
			label: draftLabel.trim(),
			model: draftModel.trim(),
			baseUrl: draftBaseUrl.trim() || null,
			apiKeyPreview: null,
			newKey: draftKey.trim(),
			isNew: true
		};
		entries = [...entries, entry];
		if (!sharedId) sharedId = entry.id;
		adding = false;
		persistNow();
	}

	function removeEntry(id: string): void {
		entries = entries.filter((e) => e.id !== id);
		if (sharedId === id) sharedId = entries[0]?.id ?? '';
		for (const role of MODEL_ROLES) {
			if (roleIds[role] === id) roleIds[role] = SHARED_SENTINEL;
		}
		persistNow();
	}

	async function save(persistOnly = false): Promise<void> {
		const ok = await modelSettingsUi.save({
			models: entries.map((e) => ({
				id: e.id,
				label: e.label,
				model: e.model,
				...(e.baseUrl ? { baseUrl: e.baseUrl } : {}),
				apiKey: e.isNew ? e.newKey : ''
			})),
			sharedModelId: sharedId || null,
			roles: Object.fromEntries(
				MODEL_ROLES.map((r) => [r, roleIds[r] === SHARED_SENTINEL ? '' : roleIds[r]])
			)
		});
		if (ok && !persistOnly) modelSettingsUi.hide();
	}

	/** Silent persist for add/remove/routing changes — no modal close. */
	function persistNow(): void {
		void save(true);
	}
</script>

<Modal.Root bind:open={modelSettingsUi.open}>
	<Modal.Content size="lg">
		<Modal.Header>
			<Modal.Title>Reviewer models</Modal.Title>
			<Modal.Description>
				OpenAI-compatible endpoints for the review harness (vLLM, OpenRouter, or DashScope).
				Saved on the server{modelSettingsUi.config?.apiKeyPreview
					? ` · key ${modelSettingsUi.config.apiKeyPreview}`
					: ''}.
			</Modal.Description>
		</Modal.Header>
		<Modal.Body class="gap-4">
			{#if modelSettingsUi.loading && !modelSettingsUi.config}
				<div class="flex flex-col gap-3" role="status" aria-label="Loading model settings">
					<Skeleton class="h-10 w-full rounded-lg" />
					<Skeleton class="h-10 w-full rounded-lg" />
					<Skeleton class="h-10 w-2/3 rounded-lg" />
				</div>
			{:else}
				<div class="flex flex-col gap-1.5">
					<div class="flex items-center justify-between">
						<span class="text-[14px] font-medium">Models</span>
						{#if !adding}
							<Button variant="ghost" size="sm" class="h-9 font-sans" onclick={startAdd}>
								<Plus size={13} />
								Add model
							</Button>
						{/if}
					</div>
					{#if !hasEntries && !adding}
						<p class="m-0 text-[13px] text-foreground-muted">
							No models yet — add one below. Environment config still applies as fallback.
						</p>
					{/if}
					<div class="grid gap-2">
						{#each entries as entry (entry.id)}
							<div
								class="flex items-center gap-2.5 rounded-lg border border-border bg-card px-3 py-2"
							>
								<div class="min-w-0 flex-1">
									<div class="truncate text-[14px] font-medium">{entry.label}</div>
									<div class="truncate font-mono text-[12px] text-foreground-muted">
										{entry.model}
									</div>
								</div>
								{#if entry.apiKeyPreview}
									<span class="shrink-0 font-mono text-[12px] text-foreground-muted">
										{entry.apiKeyPreview}
									</span>
								{:else}
									<span class="shrink-0 text-[12px] font-medium text-warning">no key</span>
								{/if}
								{#if entry.id === sharedId}
									<span class="shrink-0 text-[12px] text-success">Shared</span>
								{/if}
								<Button
									variant="ghost"
									size="icon"
									class="h-7 w-7 shrink-0"
									aria-label="Remove {entry.label}"
									onclick={() => removeEntry(entry.id)}
								>
									<X size={13} />
								</Button>
							</div>
						{/each}
					</div>
					{#if adding}
						<div class="grid gap-3 rounded-lg border border-border p-3">
							<Input label="Label" placeholder="Qwen coder" bind:value={draftLabel} />
							<Input
								label="Model"
								placeholder="qwen/qwen-2.5-coder-32b-instruct"
								bind:value={draftModel}
							/>
							<div class="grid gap-3 sm:grid-cols-2">
								<Input
									label="Base URL"
									placeholder="https://openrouter.ai/api/v1"
									inputmode="url"
									bind:value={draftBaseUrl}
								/>
								<Input
									type="password"
									label="API key"
									placeholder="sk-or-…"
									bind:value={draftKey}
								/>
							</div>
							<div class="flex items-center gap-1">
								<Button
									variant="ghost"
									size="sm"
									class="h-9 font-sans"
									onclick={() => (adding = false)}
								>
									Cancel
								</Button>
								<Button
									variant="secondary"
									size="sm"
									class="h-9 font-sans"
									disabled={!draftLabel.trim() || !draftModel.trim()}
									onclick={confirmAdd}
								>
									Add
								</Button>
							</div>
						</div>
					{/if}
				</div>
				<Collapsible.Root open={hasEntries}>
					<Collapsible.Content>
						<div class="flex flex-col gap-3">
							<div class="flex flex-col gap-1.5">
								<span class="text-[14px] font-medium">Shared model</span>
								<Select.Root value={sharedId}>
									<Select.Trigger class="w-full justify-between" variant="outline">
										<span class="truncate">
											{sharedEntry ? `${sharedEntry.label} · ${sharedEntry.model}` : 'Select a model'}
										</span>
									</Select.Trigger>
									<Select.Content>
										{#each entries as entry (entry.id)}
											<Select.Item
												value={entry.id}
												onclick={() => {
													sharedId = entry.id;
													persistNow();
												}}
											>
												<span class="flex-1 truncate">{entry.label}</span>
												<span class="ml-2 truncate font-mono text-foreground-muted">
													{entry.model}
												</span>
											</Select.Item>
										{/each}
									</Select.Content>
								</Select.Root>
							</div>
							<div class="grid gap-3 sm:grid-cols-2">
								{#each MODEL_ROLES as role (role)}
									<div class="flex flex-col gap-1.5">
										<span class="text-[14px] font-medium capitalize">{role}</span>
										<Select.Root value={roleIds[role]}>
											<Select.Trigger class="w-full justify-between" variant="outline">
												<span class="truncate">{roleLabel(role)}</span>
											</Select.Trigger>
											<Select.Content>
												<Select.Item
													value={SHARED_SENTINEL}
													onclick={() => {
														roleIds[role] = SHARED_SENTINEL;
														persistNow();
													}}
												>
													Use shared
												</Select.Item>
												{#each entries as entry (entry.id)}
													<Select.Item
														value={entry.id}
														onclick={() => {
															roleIds[role] = entry.id;
															persistNow();
														}}
													>
														<span class="flex-1 truncate">{entry.label}</span>
													</Select.Item>
												{/each}
											</Select.Content>
										</Select.Root>
									</div>
								{/each}
							</div>
						</div>
					</Collapsible.Content>
				</Collapsible.Root>
			{/if}
			{#if modelSettingsUi.error}
				<p class="text-[13px] font-medium text-error" role="alert">{modelSettingsUi.error}</p>
			{/if}
		</Modal.Body>
		<Modal.Footer>
			<Modal.Close>
				Cancel
				<Shortcut shortcut="esc" />
			</Modal.Close>
			<Button
				variant="primary"
				class="h-9 font-sans"
				loading={modelSettingsUi.saving}
				onclick={() => void save()}
			>
				Save
				<Shortcut shortcut="enter" />
			</Button>
		</Modal.Footer>
	</Modal.Content>
</Modal.Root>
