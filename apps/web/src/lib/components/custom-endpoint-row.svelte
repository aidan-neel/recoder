<script lang="ts">
	import Plus from '@lucide/svelte/icons/plus';
	import ScanSearch from '@lucide/svelte/icons/scan-search';
	import X from '@lucide/svelte/icons/x';
	import { Button } from '@sivir-ui/svelte/components/button';
	import { Input } from '@sivir-ui/svelte/components/input';
	import * as Modal from '@sivir-ui/svelte/components/modal';
	import { toast } from '@sivir-ui/svelte/components/toast';
	import * as Typography from '@sivir-ui/svelte/components/typography';
	import { formatContextWindow, modelSettingsUi } from '$lib/model-settings.svelte';
	import { errorToast, undoToast } from '$lib/notify';
	import { serverApi } from '$lib/server-api';

	/**
	 * Your own OpenAI-compatible server (vLLM, Ollama, LM Studio). The only
	 * provider whose models are detected from the server itself; hosted
	 * providers pick from their catalog instead.
	 */
	const id = $props.id();
	const config = $derived(modelSettingsUi.config);
	const endpointModels = $derived((config?.models ?? []).filter((entry) => entry.provider !== 'codex' && !entry.source));
	const isSet = $derived(!!config?.baseUrl);

	let open = $state(false);
	let baseUrl = $state('');
	let apiKey = $state('');
	let saving = $state(false);

	function host(url: string): string {
		try {
			return new URL(url).host;
		} catch {
			return url;
		}
	}

	function openManage(): void {
		baseUrl = config?.baseUrl ?? '';
		apiKey = '';
		addOpen = false;
		open = true;
	}

	/** Save the URL and key; an empty key keeps the saved one. */
	async function saveEndpoint(): Promise<boolean> {
		const url = baseUrl.trim();
		if (url === (config?.baseUrl ?? '') && !apiKey.trim()) return true;
		saving = true;
		const ok = await modelSettingsUi.save({ baseUrl: url, ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}) });
		saving = false;
		if (ok) apiKey = '';
		else errorToast('Could not save the endpoint', modelSettingsUi.error ?? undefined);
		return ok;
	}

	async function done(): Promise<void> {
		if (await saveEndpoint()) open = false;
	}

	function randomId(): string {
		return typeof crypto !== 'undefined' && 'randomUUID' in crypto
			? crypto.randomUUID()
			: `m-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
	}

	/** "ornith-ai/Ornith-1.5-35B-A3B" → "Ornith 1.5 35B A3B". */
	function labelFor(modelId: string): string {
		return (modelId.split('/').pop() ?? modelId).replace(/[-_]+/g, ' ').replace(/\b([a-z])/g, (c) => c.toUpperCase()).trim();
	}

	let detecting = $state(false);

	/** Ask the server what it serves: new models are added, known ones get their context window. */
	async function detect(): Promise<void> {
		if (detecting || !baseUrl.trim()) return;
		detecting = true;
		try {
			const found = await serverApi.discoverModels({ baseUrl: baseUrl.trim(), apiKey: apiKey.trim() || undefined });
			baseUrl = found.baseUrl;
			if (!(await saveEndpoint())) return;
			const current = modelSettingsUi.config;
			if (!current) return;
			const windows = new Map(found.models.map((m) => [m.id, m.contextWindow] as const));
			const known = new Set(endpointModels.map((e) => e.model));
			const fresh = found.models.filter((m) => !known.has(m.id));
			const updated = current.models.map((entry) => {
				const window = entry.provider !== 'codex' && !entry.source ? windows.get(entry.model) : null;
				return window ? { ...entry, contextWindow: window } : entry;
			});
			const changed = fresh.length > 0 || updated.some((entry, i) => entry.contextWindow !== current.models[i].contextWindow);
			if (changed && !(await modelSettingsUi.saveModels([
				...updated,
				...fresh.map((m) => ({
					id: randomId(), provider: 'openai-compatible' as const, label: labelFor(m.id), model: m.id,
					baseUrl: null, apiKeyPreview: null, ...(m.contextWindow ? { contextWindow: m.contextWindow } : {})
				}))
			]))) throw new Error(modelSettingsUi.error ?? 'Could not save the models');
			toast.success(fresh.length ? `Added ${fresh.length} model${fresh.length === 1 ? '' : 's'}` : `${found.models.length} model${found.models.length === 1 ? '' : 's'} on this server, all added`);
		} catch (e) {
			errorToast('Could not detect models', e instanceof Error ? e.message : undefined);
		} finally {
			detecting = false;
		}
	}

	let addOpen = $state(false);
	let label = $state('');
	let model = $state('');
	let adding = $state(false);

	async function addModel(event: SubmitEvent): Promise<void> {
		event.preventDefault();
		if (adding || !label.trim() || !model.trim() || !(await saveEndpoint())) return;
		const current = modelSettingsUi.config;
		if (!current) return;
		adding = true;
		const ok = await modelSettingsUi.saveModels([
			...current.models,
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

	let disconnecting = $state(false);

	/** Forget the server: its URL, key and models. */
	async function disconnect(): Promise<void> {
		const current = modelSettingsUi.config;
		if (!current || disconnecting) return;
		disconnecting = true;
		const kept = current.models.filter((entry) => entry.provider === 'codex' || !!entry.source);
		const ok = (await modelSettingsUi.saveModels(kept)) && (await modelSettingsUi.save({ baseUrl: '' }));
		disconnecting = false;
		if (ok) {
			open = false;
			toast.success('Disconnected your server');
		} else {
			errorToast('Could not disconnect', modelSettingsUi.error ?? undefined);
		}
	}

	async function removeModel(modelId: string): Promise<void> {
		if (!config) return;
		const previous = config.models;
		const removed = previous.find((entry) => entry.id === modelId);
		if (!(await modelSettingsUi.saveModels(previous.filter((entry) => entry.id !== modelId)))) {
			errorToast('Could not remove the model', modelSettingsUi.error ?? undefined);
			return;
		}
		undoToast(`Removed ${removed?.label ?? 'model'}`, () => void modelSettingsUi.saveModels(previous));
	}
</script>

<div class="settings-row">
	<div class="min-w-0 flex-1">
		<p class="settings-row-name">Your own server</p>
		<p class="settings-row-desc">
			{#if isSet}<span class="font-mono">{host(config?.baseUrl ?? '')}</span><span class="mx-1.5" aria-hidden="true">·</span>{endpointModels.length} {endpointModels.length === 1 ? 'model' : 'models'}
			{:else}vLLM, Ollama, LM Studio or any OpenAI-compatible server{/if}
		</p>
	</div>
	<Button variant="outline" class="provider-action" disabled={!config} onclick={openManage}>{isSet ? 'Models' : 'Connect'}</Button>
</div>

<Modal.Root bind:open>
	<Modal.Content size="md">
		<Modal.Header><Modal.Title>Your own server</Modal.Title></Modal.Header>
		<Modal.Body class="gap-4">
			<div class="grid gap-3">
				<Input type="url" label="Base URL" placeholder="http://localhost:8000/v1" autocomplete="off" spellcheck={false} bind:value={baseUrl} />
				<Input
					type="password"
					label="API key"
					placeholder={config?.apiKeyPreview ? `Saved · ${config.apiKeyPreview}` : 'Optional for local servers'}
					autocomplete="off"
					bind:value={apiKey}
				/>
			</div>
			<div class="flex flex-col gap-2">
				<div class="flex items-center gap-1">
					<Typography.Text class="me-auto text-[13px] text-fg-muted">Models</Typography.Text>
					<Button variant="ghost" class="provider-link" loading={detecting} disabled={!baseUrl.trim()} onclick={() => void detect()}>
						<ScanSearch size={13} aria-hidden="true" /> Detect models
					</Button>
					<Button variant="ghost" class="provider-link" onclick={() => (addOpen = !addOpen)} aria-expanded={addOpen}>
						<Plus size={13} aria-hidden="true" /> Add by ID
					</Button>
				</div>
				{#if addOpen}
					<form id="{id}-add" class="grid grid-cols-[1fr_1fr_auto] items-end gap-2" onsubmit={addModel}>
						<Input label="Name" placeholder="Qwen3 Coder" required bind:value={label} />
						<Input label="Model ID" placeholder="qwen/qwen3-coder" required bind:value={model} />
						<Button type="submit" variant="outline" loading={adding}>Add</Button>
					</form>
				{/if}
				{#if endpointModels.length > 0}
					<ul class="endpoint-models" aria-label="Models on your server">
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
				{:else}
					<p class="m-0 text-[12.5px] text-fg-faint">No models yet. Detect them from the server, or add one by ID.</p>
				{/if}
			</div>
		</Modal.Body>
		<Modal.Footer>
			{#if isSet}<Button variant="ghost" class="me-auto" loading={disconnecting} disabled={saving} onclick={() => void disconnect()}>Disconnect</Button>{/if}
			<Modal.Close disabled={saving}>Cancel</Modal.Close>
			<Button loading={saving} onclick={() => void done()}>Save</Button>
		</Modal.Footer>
	</Modal.Content>
</Modal.Root>
