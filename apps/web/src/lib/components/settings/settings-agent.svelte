<script lang="ts">
	import { untrack } from 'svelte';
	import Plus from '@lucide/svelte/icons/plus';
	import RotateCw from '@lucide/svelte/icons/rotate-cw';
	import * as Alert from '@sivir-ui/svelte/components/alert';
	import * as AlertDialog from '@sivir-ui/svelte/components/alert-dialog';
	import { Badge } from '@sivir-ui/svelte/components/badge';
	import { Button } from '@sivir-ui/svelte/components/button';
	import * as Card from '@sivir-ui/svelte/components/card';
	import { CopyButton } from '@sivir-ui/svelte/components/copy-button';
	import { toast } from '@sivir-ui/svelte/components/toast';
	import * as Typography from '@sivir-ui/svelte/components/typography';
	import type { AgentProvider } from '@recoder/shared';
	import AgentProviderModal from './agent-provider-modal.svelte';
	import ModelPicker from './model-picker.svelte';
	import { agent } from '$lib/settings/agent.svelte';
	import { modelSettingsUi } from '$lib/settings/model-settings.svelte';
	import { errorToast } from '$lib/shell/notify';
	import { settingsDraft } from '$lib/settings/settings-draft.svelte';

	const INSTALL = 'curl -fsSL https://opencode.ai/install | bash';

	let addOpen = $state(false);
	let addId = $state<string | null>(null);
	let removing = $state<string | null>(null);
	let confirmOpen = $state(false);
	/** Outlives the dialog's close so its copy holds while it animates out. */
	let confirming = $state<AgentProvider | null>(null);

	function askRemove(provider: AgentProvider): void {
		confirming = provider;
		confirmOpen = true;
	}

	const status = $derived(agent.status);
	const ready = $derived(!!status?.installed && !status.error);

	/** Home and failure toasts open Settings straight into Add provider. */
	$effect(() => {
		if (modelSettingsUi.intent?.kind !== 'add-provider' || !ready) return;

		untrack(() => {
			modelSettingsUi.intent = null;
			openAdd();
		});
	});

	function openAdd(id: string | null = null): void {
		addId = id;
		addOpen = true;
	}

	function describe(provider: AgentProvider): string {
		const models = `${provider.modelCount} ${provider.modelCount === 1 ? 'model' : 'models'}`;

		const via = {
			key: 'API key',
			oauth: 'Signed in',
			config: 'From OpenCode config',
			env: 'From environment',
			builtin: 'Free tier'
		}[provider.via ?? 'builtin'];

		return `${models} · ${via}`;
	}

	async function remove(provider: AgentProvider): Promise<void> {
		removing = provider.id;

		try {
			await agent.remove(provider.id);
			toast.success(`Disconnected ${provider.name}`);
		} catch (e) {
			errorToast(`Could not disconnect ${provider.name}`, e instanceof Error ? e.message : undefined);
		} finally {
			removing = null;
		}
	}
</script>

<section class="settings-section" aria-labelledby="agent-cli">
	<Typography.H3 id="agent-cli" class="settings-label">CLI</Typography.H3>
	<Card.Root class="settings-list">
		<div class="settings-row">
			<div class="min-w-0 flex-1">
				<p class="settings-row-name">OpenCode</p>
				<p class="settings-row-desc">
					{#if agent.error}{agent.error}
					{:else if !status?.installed}Not installed
					{:else if status.error}{status.error}
					{:else}<span class="font-mono">{status.version ?? 'unknown version'}</span> ·
						<span class="font-mono" title={status.path ?? ''}>{status.path}</span>{/if}
				</p>
			</div>
			{#if ready && !agent.error}
				<Badge class="status-chip" data-tone="success">Ready</Badge>
			{:else}
				<Button variant="outline" loading={agent.checking} onclick={() => void agent.load(true)}>
					<RotateCw size={13} aria-hidden="true" /> Check again
				</Button>
			{/if}
		</div>
		{#if !agent.error && status && !status.installed}
			<div class="settings-row agent-install">
				<div class="min-w-0 flex-1">
					<p class="settings-row-desc mb-2">Install it, then check again.</p>
					<div class="agent-install-cmd">
						<code>{INSTALL}</code>
						<CopyButton text={INSTALL} label="Copy command" />
					</div>
				</div>
			</div>
		{/if}
	</Card.Root>
</section>

{#if ready && !agent.error}
	<section class="settings-section" aria-labelledby="agent-providers">
		<div class="flex items-baseline justify-between gap-3">
			<Typography.H3 id="agent-providers" class="settings-label">Providers</Typography.H3>
			<Button variant="ghost" class="provider-link" onclick={() => openAdd()}>
				<Plus size={13} aria-hidden="true" /> Add provider
			</Button>
		</div>
		{#if agent.connected.length === 0}
			<p class="settings-empty">No providers yet. Add one to pick models for reviews.</p>
		{:else}
			<Card.Root class="settings-list">
				{#each agent.connected as provider (provider.id)}
					<div class="settings-row">
						<div class="min-w-0 flex-1">
							<p class="settings-row-name">{provider.name}</p>
							<p class="settings-row-desc">{describe(provider)}</p>
						</div>
						{#if provider.removable}
							<Button
								variant="ghost"
								class="provider-link"
								loading={removing === provider.id}
								onclick={() => askRemove(provider)}
							>
								Disconnect
							</Button>
						{:else if provider.via === 'builtin' && provider.methods.length}
							<Button variant="ghost" class="provider-link" onclick={() => openAdd(provider.id)}>Add key</Button>
						{/if}
					</div>
				{/each}
			</Card.Root>
		{/if}
	</section>

	<section class="settings-section" aria-labelledby="agent-roles">
		<Typography.H3 id="agent-roles" class="settings-label">Models</Typography.H3>
		<Card.Root class="settings-list">
			<div class="settings-row role-row">
				<div class="min-w-0 flex-1">
					<p class="settings-row-name">Review</p>
					<p class="settings-row-desc">Plans the review, writes the summary and answers in chat</p>
				</div>
				<ModelPicker
					value={settingsDraft.orchestrator}
					onSelect={(choice) => (settingsDraft.orchestrator = choice)}
					label="Review model and reasoning effort"
				/>
			</div>
			<div class="settings-row role-row">
				<div class="min-w-0 flex-1">
					<p class="settings-row-name">Specialists</p>
					<p class="settings-row-desc">Every specialist in a review runs on this model</p>
				</div>
				<ModelPicker
					value={settingsDraft.specialist}
					onSelect={(choice) => (settingsDraft.specialist = choice)}
					placeholder="Same as Review"
					onFollow={() => (settingsDraft.specialist = null)}
					label="Specialist model and reasoning effort"
				/>
			</div>
		</Card.Root>
	</section>
{/if}

<AgentProviderModal bind:open={addOpen} providerId={addId} />

<AlertDialog.Root bind:open={confirmOpen}>
	<AlertDialog.Content>
		<AlertDialog.Header>
			<AlertDialog.Title>Disconnect {confirming?.name}?</AlertDialog.Title>
			<AlertDialog.Description>
				OpenCode forgets {confirming?.via === 'oauth' ? 'this sign-in' : 'this key'}. Reviews set to its models stop
				until you connect it again.
			</AlertDialog.Description>
		</AlertDialog.Header>
		<AlertDialog.Footer>
			<AlertDialog.Exit>Cancel</AlertDialog.Exit>
			<AlertDialog.Confirm
				variant="destructive"
				onclick={() => {
					confirmOpen = false;
					if (confirming) void remove(confirming);
				}}>Disconnect</AlertDialog.Confirm
			>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>
