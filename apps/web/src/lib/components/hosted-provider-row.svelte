<script lang="ts">
	import ArrowUpRight from '@lucide/svelte/icons/arrow-up-right';
	import Search from '@lucide/svelte/icons/search';
	import * as Alert from '@sivir-ui/svelte/components/alert';
	import { Button } from '@sivir-ui/svelte/components/button';
	import { Checkbox } from '@sivir-ui/svelte/components/checkbox';
	import { Input } from '@sivir-ui/svelte/components/input';
	import * as Modal from '@sivir-ui/svelte/components/modal';
	import { ScrollArea } from '@sivir-ui/svelte/components/scroll-area';
	import { toast } from '@sivir-ui/svelte/components/toast';
	import * as Typography from '@sivir-ui/svelte/components/typography';
	import type { CatalogModel, HostedProvider } from '@recoder/shared';
	import Skeleton from './ui/skeleton.svelte';
	import { hostedProviders } from '$lib/hosted-providers.svelte';
	import { formatContextWindow, modelSettingsUi } from '$lib/model-settings.svelte';
	import { errorToast } from '$lib/notify';

	let { provider }: { provider: HostedProvider } = $props();
	const id = $props.id();

	const added = $derived(hostedProviders.models(provider.id));

	/* ── Connect ─────────────────────────────────────────────── */

	let connectOpen = $state(false);
	let apiKey = $state('');
	let connecting = $state(false);
	let connectError = $state<string | null>(null);

	function openConnect(): void {
		apiKey = '';
		connectError = null;
		connectOpen = true;
	}

	async function connect(event: SubmitEvent): Promise<void> {
		event.preventDefault();
		if (connecting || !apiKey.trim()) return;
		connecting = true;
		connectError = null;
		try {
			await hostedProviders.connect(provider.id, apiKey.trim());
			connectOpen = false;
			// Straight on to choosing models: a key with no models does nothing yet.
			void openModels(true);
		} catch (e) {
			connectError = e instanceof Error ? e.message : 'Could not connect.';
		} finally {
			connecting = false;
		}
	}

	let disconnecting = $state(false);

	/** Resolves true once disconnected; a failure is already toasted. */
	async function disconnect(): Promise<boolean> {
		if (disconnecting) return false;
		disconnecting = true;
		try {
			await hostedProviders.disconnect(provider.id);
			toast.success(`Disconnected ${provider.name}`);
			return true;
		} catch (e) {
			errorToast(`Could not disconnect ${provider.name}`, e instanceof Error ? e.message : undefined);
			return false;
		} finally {
			disconnecting = false;
		}
	}

	/* ── Models ──────────────────────────────────────────────── */

	/** Past this many, a fresh connection starts with nothing picked (OpenRouter lists hundreds). */
	const PICK_ALL_UP_TO = 40;

	let modelsOpen = $state(false);
	let catalog = $state<CatalogModel[] | null>(null);
	let catalogError = $state<string | null>(null);
	let picked = $state(new Set<string>());
	let query = $state('');
	let saving = $state(false);

	async function openModels(fresh = false): Promise<void> {
		query = '';
		catalogError = null;
		picked = new Set(added.map((entry) => entry.model));
		modelsOpen = true;
		try {
			catalog = await hostedProviders.catalog(provider.id);
			const supported = catalog.filter((model) => model.supported);
			if (fresh && picked.size === 0 && supported.length <= PICK_ALL_UP_TO) picked = new Set(supported.map((model) => model.id));
		} catch (e) {
			catalogError = e instanceof Error ? e.message : 'Could not load the model list.';
		}
	}

	function retryCatalog(): void {
		catalog = null;
		void openModels();
	}

	const q = $derived(query.trim().toLowerCase());
	const shown = $derived(
		(catalog ?? []).filter((model) => !q || model.name.toLowerCase().includes(q) || model.id.toLowerCase().includes(q))
	);
	/** Picked first while nothing is typed, so what you have is on top of a long list. */
	const ordered = $derived(q ? shown : [...shown].sort((a, b) => Number(picked.has(b.id)) - Number(picked.has(a.id))));
	const initial = $derived(new Set(added.map((entry) => entry.model)));
	const changes = $derived(
		[...picked].filter((m) => !initial.has(m)).length + [...initial].filter((m) => !picked.has(m)).length
	);

	function toggle(modelId: string, on: boolean): void {
		const next = new Set(picked);
		if (on) next.add(modelId);
		else next.delete(modelId);
		picked = next;
	}

	async function saveModels(): Promise<void> {
		if (!catalog || saving) return;
		saving = true;
		const ok = await hostedProviders.setModels(provider.id, catalog.filter((model) => picked.has(model.id)));
		saving = false;
		if (ok) modelsOpen = false;
		else errorToast('Could not save the models', modelSettingsUi.error ?? undefined);
	}

	function price(model: CatalogModel): string | null {
		if (model.inputCost === null) return null;
		return model.inputCost === 0 ? 'Free' : `$${model.inputCost}/M in`;
	}
</script>

<div class="settings-row">
	<div class="min-w-0 flex-1">
		<p class="settings-row-name">{provider.name}</p>
		<p class="settings-row-desc">
			{#if provider.connected}
				{added.length} {added.length === 1 ? 'model' : 'models'}{#if provider.apiKeyPreview}<span class="mx-1.5" aria-hidden="true">·</span><span class="font-mono">{provider.apiKeyPreview}</span>{/if}
			{:else}{provider.blurb}{/if}
		</p>
	</div>
	{#if provider.connected}
		<Button variant="outline" class="provider-action" onclick={() => void openModels()}>Models</Button>
	{:else}
		<Button variant="outline" class="provider-action" onclick={openConnect}>Connect</Button>
	{/if}
</div>

<Modal.Root bind:open={connectOpen}>
	<Modal.Content size="sm">
		<Modal.Header><Modal.Title>Connect {provider.name}</Modal.Title></Modal.Header>
		<Modal.Body>
			<form id="{id}-connect" class="grid gap-3" onsubmit={connect}>
				<Input type="password" label="API key" autocomplete="off" spellcheck={false} bind:value={apiKey} />
				<Typography.Text variant="supporting" class="text-[12.5px]">
					Create a key in your {provider.name} account and paste it here. It's checked without running a model, and saved on this server only.
				</Typography.Text>
				<Button href={provider.keyUrl} variant="ghost" class="provider-link -ms-3 w-fit" target="_blank" rel="noopener noreferrer">
					Get a key <ArrowUpRight size={13} aria-hidden="true" />
				</Button>
				{#if connectError}<p class="m-0 text-[12.5px] text-danger" role="alert">{connectError}</p>{/if}
			</form>
		</Modal.Body>
		<Modal.Footer>
			<Modal.Close disabled={connecting}>Cancel</Modal.Close>
			<Button type="submit" form="{id}-connect" loading={connecting} disabled={!apiKey.trim()}>Connect</Button>
		</Modal.Footer>
	</Modal.Content>
</Modal.Root>

<Modal.Root bind:open={modelsOpen}>
	<Modal.Content size="lg">
		<Modal.Header><Modal.Title>{provider.name} models</Modal.Title></Modal.Header>
		<Modal.Body class="gap-3">
			{#if catalogError}
				<Alert.Root variant="error">
					<Alert.Title>Could not load the model list</Alert.Title>
					<Alert.Description>{catalogError}</Alert.Description>
					<Button variant="outline" class="mt-2 w-fit" onclick={retryCatalog}>Retry</Button>
				</Alert.Root>
			{:else}
				<Input placeholder="Search models" aria-label="Search {provider.name} models" bind:value={query} disabled={!catalog}>
					{#snippet leading()}<Search size={15} aria-hidden="true" />{/snippet}
				</Input>
				<ScrollArea aria-label="{provider.name} models" class="h-[52dvh]" showCues={false}>
					{#if !catalog}
						<ul class="catalog-list" role="status" aria-label="Loading models">
							{#each [0, 1, 2, 3, 4, 5, 6, 7] as i (i)}
								<li class="catalog-row">
									<Skeleton class="size-4 shrink-0 !rounded-[5px]" />
									<div class="flex min-w-0 flex-1 flex-col gap-1.5"><Skeleton class="h-3" w={[34, 28, 40, 30, 36, 26, 32, 38][i]} unit="%" /><Skeleton class="h-2.5" w={[22, 18, 26, 20, 24, 16, 22, 20][i]} unit="%" /></div>
									<Skeleton class="h-3 w-16" />
								</li>
							{/each}
						</ul>
					{:else}
						<ul class="catalog-list">
							{#each ordered as model (model.id)}
								<li class="catalog-row" data-unsupported={!model.supported || undefined}>
									<Checkbox
										checked={picked.has(model.id)}
										disabled={!model.supported}
										onCheckedChange={(on) => toggle(model.id, on)}
										aria-label="Use {model.name}"
									/>
									<div class="min-w-0 flex-1">
										<p class="truncate text-[13px] text-fg">{model.name}</p>
										<p class="truncate font-mono text-[11.5px] text-fg-faint">{model.supported ? model.id : `${model.id} · needs an API Recoder doesn't support yet`}</p>
									</div>
									<span class="catalog-meta">
										{#if model.contextWindow}<span>{formatContextWindow(model.contextWindow)}</span>{/if}
										{#if price(model)}<span>{price(model)}</span>{/if}
									</span>
								</li>
							{:else}
								<li class="py-3 text-[13px] text-fg-faint">No models match “{query.trim()}”.</li>
							{/each}
						</ul>
					{/if}
				</ScrollArea>
			{/if}
		</Modal.Body>
		<Modal.Footer>
			<Button variant="ghost" loading={disconnecting} disabled={saving} onclick={() => void disconnect().then((ok) => { if (ok) modelsOpen = false; })}>Disconnect</Button>
			<span class="me-auto ps-2 text-[12.5px] text-fg-faint tabular-nums">{picked.size} selected</span>
			<Modal.Close disabled={saving}>Cancel</Modal.Close>
			<Button loading={saving} disabled={!catalog || changes === 0} onclick={() => void saveModels()}>Save</Button>
		</Modal.Footer>
	</Modal.Content>
</Modal.Root>
