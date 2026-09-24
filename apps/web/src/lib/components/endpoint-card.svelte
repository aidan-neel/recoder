<script lang="ts">
	import Plus from '@lucide/svelte/icons/plus';
	import X from '@lucide/svelte/icons/x';
	import { Button } from '@sivir-ui/svelte/components/button';
	import * as Card from '@sivir-ui/svelte/components/card';
	import { Input } from '@sivir-ui/svelte/components/input';
	import * as Modal from '@sivir-ui/svelte/components/modal';
	import * as Typography from '@sivir-ui/svelte/components/typography';
	import { modelSettingsUi } from '$lib/model-settings.svelte';
	import { errorToast, undoToast } from '$lib/notify';
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
	<p class="provider-account">vLLM, OpenRouter or DashScope. Used for any role set to an endpoint model.</p>
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
			placeholder={config?.apiKeyPreview ? `API key · ${config.apiKeyPreview}` : 'API key'}
			aria-label="Endpoint API key"
			autocomplete="off"
			bind:value={settingsDraft.apiKey}
		/>
	</div>
	{#if endpointModels.length > 0}
		<ul class="endpoint-models" aria-label="Endpoint models">
			{#each endpointModels as entry (entry.id)}
				<li>
					<span class="min-w-0 flex-1 truncate">{entry.label}</span>
					<span class="min-w-0 truncate font-mono text-[11.5px] text-fg-faint">{entry.model}</span>
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
	<Modal.Root bind:open={addOpen}>
		<Modal.Trigger variant="ghost" class="provider-link self-start" disabled={!config}>
			<Plus size={13} aria-hidden="true" /> Add endpoint model
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
</Card.Root>
