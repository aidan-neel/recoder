<script lang="ts">
	import { untrack } from 'svelte';
	import { Button } from '@sivir-ui/svelte/components/button';
	import { Input } from '@sivir-ui/svelte/components/input';
	import * as Modal from '@sivir-ui/svelte/components/modal';
	import { Progress } from '@sivir-ui/svelte/components/progress';
	import type { CodexConnection, CodexModel } from '@recoder/shared';
	import { serverApi } from '$lib/server-api';
	import { chatGptStatus } from '$lib/chatgpt-status.svelte';
	import { modelSettingsUi } from '$lib/model-settings.svelte';

	let {
		active,
		onSync,
		onClear,
		disabled = false
	}: {
		active: boolean;
		onSync: (models: CodexModel[]) => void;
		onClear: () => void;
		disabled?: boolean;
	} = $props();
	const id = $props.id();
	let connection = $state<CodexConnection | null>(null);
	let models = $state<CodexModel[]>([]);
	let busy = $state(false);
	let error = $state('');
	let refreshError = $state('');
	let refreshing = $state(false);
	let signInOpen = $state(false);
	let modelsOpen = $state(false);
	let now = $state(Date.now());
	const loginPending = $derived(Boolean(connection?.login));
	let generation = 0;
	const limits = $derived(connection?.limits ?? []);

	function limitName(name: string): string {
		return name.replace(/\b(\d+)\s+min\b/gi, (match, value: string) => {
			const minutes = Number(value);
			if (minutes === 10080) return 'Weekly';
			if (minutes > 0 && minutes % 1440 === 0) return `${minutes / 1440}-day`;
			if (minutes > 0 && minutes % 60 === 0) return `${minutes / 60}-hour`;
			return match;
		});
	}

	function resetLabel(resetsAt: number | null): string {
		if (!resetsAt || !Number.isFinite(resetsAt))
			return 'Reset time unavailable';
		const minutes = Math.ceil((resetsAt * 1000 - now) / 60_000);
		if (minutes <= 0) return 'Awaiting reset';
		if (minutes < 60) return `Resets in ${minutes}m`;
		const hours = Math.floor(minutes / 60);
		if (hours < 24)
			return `Resets in ${hours}h${minutes % 60 ? ` ${minutes % 60}m` : ''}`;
		return `Resets in ${Math.floor(hours / 24)}d${hours % 24 ? ` ${hours % 24}h` : ''}`;
	}

	/** "resets 2h", "resets 40m", or the weekday when more than a day out. */
	function resetShort(resetsAt: number | null): string {
		if (!resetsAt || !Number.isFinite(resetsAt)) return 'reset unknown';
		const minutes = Math.ceil((resetsAt * 1000 - now) / 60_000);
		if (minutes <= 0) return 'resetting';
		if (minutes < 60) return `resets ${minutes}m`;
		if (minutes < 24 * 60) return `resets ${Math.round(minutes / 60)}h`;
		return `resets ${new Date(resetsAt * 1000).toLocaleDateString(undefined, { weekday: 'short' })}`;
	}

	function planName(plan: string): string {
		return plan
			.replace(/lite$/i, ' lite')
			.split(/[\s_-]+/)
			.map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
			.join(' ');
	}

	async function refresh(): Promise<void> {
		if (!active || busy || refreshing) return;
		const current = generation;
		refreshing = true;
		now = Date.now();
		try {
			const next = await serverApi.getCodexStatus();
			if (current !== generation || !active) return;
			connection = next;
			if (next.authenticated) {
				if (!models.length) {
					const available = await serverApi.getCodexModels();
					if (current !== generation || !active) return;
					models = available;
				}
				onSync(models);
			} else {
				// An expired sign-in keeps the ChatGPT models and role picks; signing in
				// again restores them. Only an explicit sign-out clears them.
				models = [];
			}
			refreshError = '';
		} catch (cause) {
			if (current === generation && active)
				refreshError =
					cause instanceof Error
						? cause.message
						: 'Could not refresh ChatGPT connection data.';
		} finally {
			if (current === generation) refreshing = false;
		}
	}

	$effect(() => {
		if (!active || busy) return;
		const delay = loginPending ? 3000 : 30_000;
		generation++;
		let cancelled = false;
		let timer: ReturnType<typeof setTimeout>;
		const poll = async () => {
			await refresh();
			if (!cancelled) timer = setTimeout(poll, delay);
		};
		void untrack(poll);
		return () => {
			cancelled = true;
			generation++;
			refreshing = false;
			clearTimeout(timer);
		};
	});

	async function connect(): Promise<void> {
		if (disabled || busy || !active) return;
		generation++;
		busy = true;
		error = '';
		try {
			connection = await serverApi.connectCodex();
			if (connection.login) signInOpen = true;
		} catch (cause) {
			error =
				cause instanceof Error ? cause.message : 'Could not start sign-in.';
		} finally {
			busy = false;
		}
	}

	async function disconnect(): Promise<void> {
		if (disabled || busy || !active) return;
		generation++;
		busy = true;
		error = '';
		try {
			await serverApi.disconnectCodex();
			models = [];
			connection = null;
			signInOpen = false;
			onClear();
		} catch (cause) {
			error = cause instanceof Error ? cause.message : 'Could not disconnect.';
		} finally {
			busy = false;
		}
	}

	$effect(() => {
		if (connection) chatGptStatus.signedIn = connection.authenticated;
	});

	/** A "Sign in to ChatGPT" button elsewhere opened Settings: start sign-in once the status is known. */
	$effect(() => {
		if (modelSettingsUi.intent?.kind !== 'chatgpt-sign-in' || !active || !connection || busy || disabled) return;
		untrack(() => {
			modelSettingsUi.intent = null;
			if (!connection?.authenticated) void connect();
		});
	});

	// Keep the sign-in modal in step with the pending/authenticated state.
	$effect(() => {
		if (connection?.login) signInOpen = true;
		else if (connection?.authenticated) signInOpen = false;
	});
</script>

<div class="settings-row" {...{ 'aria-labelledby': `${id}-title` }}>
	<div class="min-w-0 flex-1">
		<p class="settings-row-name" id={`${id}-title`}>ChatGPT</p>
		<p class="settings-row-desc" role="status">
			{#if !connection}{refreshError ? 'Unavailable' : 'Checking…'}
			{:else if connection.authenticated}{connection.email ?? 'Signed in'}{#if connection.planType}<span class="mx-1.5" aria-hidden="true">·</span>{planName(connection.planType)}{/if}
			{:else if connection.login}Waiting for sign-in
			{:else if error || connection.error}<span class="text-danger">{error || connection.error}</span>
			{:else}Run reviews on your ChatGPT plan{/if}
		</p>
	</div>
	{#if connection?.authenticated}
		<Button variant="outline" class="provider-action" onclick={() => (modelsOpen = true)}>Models</Button>
	{:else if connection?.login}
		<Button variant="outline" class="provider-action" onclick={() => (signInOpen = true)}>Connect</Button>
	{:else}
		<Button variant="outline" class="provider-action" loading={busy} disabled={disabled || busy || (!connection && refreshing)} onclick={connect}>Connect</Button>
	{/if}
</div>

<Modal.Root bind:open={modelsOpen}>
	<Modal.Content size="md">
		<Modal.Header><Modal.Title>ChatGPT</Modal.Title></Modal.Header>
		<Modal.Body class="gap-4">
			<p class="m-0 text-[13px] text-fg-muted">
				{connection?.email ?? 'Signed in'}{#if connection?.planType}<span class="mx-1.5" aria-hidden="true">·</span>{planName(connection.planType)}{/if}
			</p>
			{#if limits.length > 0}
				<div class="flex flex-col gap-3">
					{#each limits as limit (limit.name)}
						{@const name = limitName(limit.name)}
						{@const percent = Number.isFinite(limit.usedPercent) ? Math.max(0, Math.min(100, limit.usedPercent)) : null}
						<div class="flex flex-col gap-2">
							<div class="flex items-baseline justify-between gap-3 text-[12.5px]">
								<span class="text-fg-muted">{name}</span>
								<span class="font-mono text-[12px] text-fg-muted tabular-nums">
									{percent === null ? '—' : `${Math.round(percent)}%`}<span class="mx-1.5 text-fg-faint">·</span>{resetShort(limit.resetsAt)}
								</span>
							</div>
							{#if percent !== null}
								<Progress
									value={percent}
									max={100}
									class="usage-bar"
									data-full={percent >= 100 || undefined}
									{...{ 'aria-label': `${name} usage`, 'aria-valuetext': `${Math.round(percent)}% used. ${resetLabel(limit.resetsAt)}` }}
								/>
							{/if}
						</div>
					{/each}
				</div>
			{/if}
			{#if models.length > 0}
				<ul class="endpoint-models" aria-label="ChatGPT models">
					{#each models as model (model.id)}
						<li><span class="min-w-0 flex-1 truncate">{model.label}</span><span class="font-mono text-[11.5px] text-fg-faint">{model.id}</span></li>
					{/each}
				</ul>
			{/if}
			{#if refreshError || connection?.error}
				<div class="flex flex-wrap items-center gap-2">
					<p class="m-0 min-w-0 text-[12px] text-danger [overflow-wrap:anywhere]" role="alert">{refreshError || connection?.error}</p>
					<Button variant="ghost" class="provider-link" loading={refreshing} disabled={busy || refreshing} onclick={() => void refresh()}>Retry</Button>
				</div>
			{/if}
		</Modal.Body>
		<Modal.Footer>
			<Button variant="ghost" class="me-auto" loading={busy} disabled={disabled || busy} onclick={() => void disconnect().then(() => (modelsOpen = false))}>Sign out</Button>
			<Modal.Close>Done</Modal.Close>
		</Modal.Footer>
	</Modal.Content>
</Modal.Root>

	<Modal.Root bind:open={signInOpen}>
		<Modal.Content size="lg" aria-label="Sign in to ChatGPT">
			<Modal.Header>
				<Modal.Title>Sign in to ChatGPT</Modal.Title>
			</Modal.Header>
			<Modal.Body class="gap-3">
				{#if connection?.login}
					<p class="m-0 text-sm text-foreground-muted">
						Enter this code on the ChatGPT sign-in page.
					</p>
					<Input
						readonly
						aria-label="ChatGPT sign-in code"
						value={connection.login.userCode}
						class="select-all font-mono text-base"
					/>
					<Button
						href={connection.login.verificationUrl}
						variant="outline"
						target="_blank"
						rel="noopener noreferrer"
						class="self-start"
						>Open ChatGPT sign-in ↗</Button
					>
				{:else}
					<p class="m-0 text-sm text-foreground-muted">Waiting for sign-in to start…</p>
				{/if}
				{#if error}<p class="m-0 text-sm text-error" role="alert">{error}</p>{/if}
			</Modal.Body>
			<Modal.Footer>
				<Modal.Close disabled={busy}>Cancel</Modal.Close>
				<Button
					variant="primary"
					loading={refreshing}
					disabled={busy || !connection?.login}
					onclick={() => void refresh()}>Check sign-in</Button
				>
			</Modal.Footer>
		</Modal.Content>
	</Modal.Root>
