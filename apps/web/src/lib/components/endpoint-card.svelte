<script lang="ts">
	import { onMount } from 'svelte';
	import Plus from '@lucide/svelte/icons/plus';
	import ScanSearch from '@lucide/svelte/icons/scan-search';
	import X from '@lucide/svelte/icons/x';
	import { Button } from '@sivir-ui/svelte/components/button';
	import * as Card from '@sivir-ui/svelte/components/card';
	import { Input } from '@sivir-ui/svelte/components/input';
	import * as Modal from '@sivir-ui/svelte/components/modal';
	import * as Typography from '@sivir-ui/svelte/components/typography';
	import { formatContextWindow, modelSettingsUi } from '$lib/model-settings.svelte';
	import { errorToast, undoToast } from '$lib/notify';
	import { serverApi } from '$lib/server-api';
	import { toast } from '@sivir-ui/svelte/components/toast';
	import { settingsDraft } from '$lib/settings-draft.svelte';

	const id = $props.id();
	let addOpen = $state(false);
	let label = $state('');
	let model = $state('');
	let adding = $state(false);

	const config = $derived(modelSettingsUi.config);
	const endpointModels = $derived((config?.models ?? []).filter((entry) => entry.provider !== 'codex'));
	const isSet = $derived(!!config?.baseUrl || endpointModels.some((entry) => entry.baseUrl));

	function randomId(): string {
		return typeof crypto !== 'undefined' && 'randomUUID' in crypto
			? crypto.randomUUID()
			: `m-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
	}

	async function addModel(event: SubmitEvent): Promise<void> {
		event.preventDefault();
		if (!config || adding || !label.trim() || !model.trim()) return;
		adding = true;
		const ok = await modelSettingsUi.saveModels([
			...config.models,
			{ id: randomId(), provider: 'openai-compatible', label: label.trim(), model: model.trim(), baseUrl: null, apiKeyPreview: null }
		]);
		adding = false;
		if (ok) {
			addOpen = false;
			label = '';
			model = '';
		} else {
			errorToast('Could not add the model', modelSettingsUi.error ?? undefined);
		}
	}

	let detecting = $state(false);

	/** "ornith-ai/Ornith-1.5-35B-A3B" → "Ornith 1.5 35B A3B". */
	function labelFor(modelId: string): string {
		return (modelId.split('/').pop() ?? modelId).replace(/[-_]+/g, ' ').replace(/\b([a-z])/g, (c) => c.toUpperCase()).trim();
	}

	/**
	 * Ask the endpoint what it serves. New models are added by id and every
	 * model gets its context window. `quiet` (on open) only fills an empty list,
	 * so models someone removed don't come back on their own.
	 */
	async function detect(quiet = false): Promise<void> {
		const current = modelSettingsUi.config;
		if (!current || detecting) return;
		detecting = true;
		try {
			const found = await serverApi.discoverModels({ baseUrl: settingsDraft.baseUrl.trim() || undefined, apiKey: settingsDraft.apiKey.trim() || undefined });
			if (found.baseUrl !== settingsDraft.baseUrl.trim()) settingsDraft.baseUrl = found.baseUrl;
			const windows = new Map(found.models.map((m) => [m.id, m.contextWindow] as const));
			const known = new Set(current.models.filter((e) => e.provider !== 'codex').map((e) => e.model));
			const fresh = quiet && known.size > 0 ? [] : found.models.filter((m) => !known.has(m.id));
			const updated = current.models.map((entry) => {
				const window = entry.provider !== 'codex' ? windows.get(entry.model) : null;
				return window ? { ...entry, contextWindow: window } : entry;
			});
			const changed = fresh.length > 0 || updated.some((entry, i) => entry.contextWindow !== current.models[i].contextWindow);
			if (changed) {
				const ok = await modelSettingsUi.saveModels([
					...updated,
					...fresh.map((m) => ({
						id: randomId(), provider: 'openai-compatible' as const, label: labelFor(m.id), model: m.id,
						baseUrl: null, apiKeyPreview: null, ...(m.contextWindow ? { contextWindow: m.contextWindow } : {})
					}))
				]);
				if (!ok) throw new Error(modelSettingsUi.error ?? 'Could not save the models');
			}
			if (!quiet) {
				toast.success(fresh.length ? `Added ${fresh.length} model${fresh.length === 1 ? '' : 's'}` : `${found.models.length} model${found.models.length === 1 ? '' : 's'} on this endpoint, all added`);
			}
		} catch (e) {
			if (!quiet) errorToast('Could not detect models', e instanceof Error ? e.message : undefined);
		} finally {
			detecting = false;
		}
	}

	onMount(() => {
		if (settingsDraft.baseUrl.trim() || config?.baseUrl) void detect(true);
	});

	async function removeModel(modelId: string): Promise<void> {
		if (!config) return;
		const previous = config.models;
		const removed = previous.find((entry) => entry.id === modelId);
		const ok = await modelSettingsUi.saveModels(previous.filter((entry) => entry.id !== modelId));
		if (!ok) {
			errorToast('Could not remove the model', modelSettingsUi.error ?? undefined);
			return;
		}
		undoToast(`Removed ${removed?.label ?? 'model'}`, () => void modelSettingsUi.saveModels(previous));
	}
</script>

<Card.Root class="provider-card" {...{ "aria-labelledby": `${id}-title` }}>
	<div class="provider-card-head">
		<span class="provider-dot" data-on={isSet || undefined} aria-hidden="true"></span>
		<Typography.Title level={3} id="{id}-title" class="provider-card-title">OpenAI-compatible</Typography.Title>
		<span class="provider-status" data-on={isSet || undefined}>{isSet ? 'Set' : 'Not set'}</span>
	</div>
	<p class="provider-account">vLLM, OpenRouter or DashScope models, for Review or Specialists.</p>
	<div class="provider-fields">
		<Input
			type="url"
			placeholder="https://openrouter.ai/api/v1"
			aria-label="Endpoint base URL"
			autocomplete="off"
			bind:value={settingsDraft.baseUrl}
		/>
		<Input
			type="password"
			placeholder={config?.apiKeyPreview ? `API key · ${config.apiKeyPreview}` : 'API key (optional)'}
			aria-label="Endpoint API key"
			autocomplete="off"
			bind:value={settingsDraft.apiKey}
		/>
	</div>
	{#if endpointModels.length > 0}
		<ul class="endpoint-models" aria-label="Endpoint models">
			{#each endpointModels as entry (entry.id)}
				<li>
					<span class="min-w-0 max-w-[55%] shrink-0 truncate">{entry.label}</span>
					<span class="min-w-0 flex-1 truncate font-mono text-[11.5px] text-fg-faint" title={entry.model}>{entry.model}</span>
					{#if entry.contextWindow}<span class="endpoint-ctx" title="{entry.contextWindow.toLocaleString()} tokens">{formatContextWindow(entry.contextWindow)}</span>{/if}
					<Button
						variant="ghost"
						size="icon"
						class="endpoint-remove"
						aria-label="Remove {entry.label}"
						disabled={modelSettingsUi.saving}
						onclick={() => void removeModel(entry.id)}
					>
						<X size={13} aria-hidden="true" />
					</Button>
				</li>
			{/each}
		</ul>
	{/if}
	<div class="flex flex-wrap items-center gap-1">
		<Button variant="ghost" class="provider-link" loading={detecting} disabled={!config || (!settingsDraft.baseUrl.trim() && !config?.baseUrl)} onclick={() => void detect()}>
			<ScanSearch size={13} aria-hidden="true" /> Detect models
		</Button>
	<Modal.Root bind:open={addOpen}>
		<Modal.Trigger variant="ghost" class="provider-link" disabled={!config}>
			<Plus size={13} aria-hidden="true" /> Add manually
		</Modal.Trigger>
		<Modal.Content size="sm">
			<Modal.Header><Modal.Title>Add endpoint model</Modal.Title></Modal.Header>
			<Modal.Body>
				<form id="{id}-add" class="grid gap-3" onsubmit={addModel}>
					<Input label="Name" placeholder="Qwen3 Coder" required bind:value={label} />
					<Input label="Model ID" placeholder="qwen/qwen3-coder" required bind:value={model} />
				</form>
			</Modal.Body>
			<Modal.Footer>
				<Modal.Close>Cancel</Modal.Close>
				<Button type="submit" form="{id}-add" loading={adding}>Add model</Button>
			</Modal.Footer>
		</Modal.Content>
	</Modal.Root>
	</div>
</Card.Root>
