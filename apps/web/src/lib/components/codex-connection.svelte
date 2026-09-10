<script lang="ts">
	import { untrack } from 'svelte';
	import { Button } from '@sivir-ui/svelte/components/button';
	import * as Popover from '@sivir-ui/svelte/components/popover';
	import { ScrollArea } from '@sivir-ui/svelte/components/scroll-area';
	import * as Select from '@sivir-ui/svelte/components/select';
	import type { CodexConnection, CodexModel } from '@recoder/shared';
	import { serverApi } from '$lib/server-api';

	let { active, onAdd, disabled = false }: {
		active: boolean;
		onAdd: (model: CodexModel) => void;
		disabled?: boolean;
	} = $props();
	const id = $props.id();
	let connection = $state<CodexConnection | null>(null);
	let models = $state<CodexModel[]>([]);
	let selected = $state('');
	let busy = $state(false);
	let error = $state('');
	let refreshError = $state('');
	let refreshing = $state(false);
	let now = $state(Date.now());
	const selectedModel = $derived(models.find((model) => model.id === selected));
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
		if (!resetsAt || !Number.isFinite(resetsAt)) return 'Reset time unavailable';
		const minutes = Math.ceil((resetsAt * 1000 - now) / 60_000);
		if (minutes <= 0) return 'Awaiting reset';
		if (minutes < 60) return `Resets in ${minutes}m`;
		const hours = Math.floor(minutes / 60);
		if (hours < 24) return `Resets in ${hours}h${minutes % 60 ? ` ${minutes % 60}m` : ''}`;
		return `Resets in ${Math.floor(hours / 24)}d${hours % 24 ? ` ${hours % 24}h` : ''}`;
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
			if (next.authenticated && !models.length) {
				const available = await serverApi.getCodexModels();
				if (current !== generation || !active) return;
				models = available;
				selected = available.find((model) => /luna/i.test(model.id))?.id ?? available[0]?.id ?? '';
			}
			if (!next.authenticated) { models = []; selected = ''; }
			refreshError = '';
		} catch (cause) {
			if (current === generation && active) refreshError = cause instanceof Error ? cause.message : 'Could not refresh ChatGPT connection data.';
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
		return () => { cancelled = true; generation++; refreshing = false; clearTimeout(timer); };
	});

	async function connect(): Promise<void> {
		if (disabled || busy || !active) return;
		generation++;
		busy = true; error = '';
		try { connection = await serverApi.connectCodex(); }
		catch (cause) { error = cause instanceof Error ? cause.message : 'Could not start sign-in.'; }
		finally { busy = false; }
	}

	async function disconnect(): Promise<void> {
		if (disabled || busy || !active) return;
		generation++;
		busy = true; error = '';
		try {
			await serverApi.disconnectCodex();
			models = []; selected = '';
			connection = null;
		} catch (cause) { error = cause instanceof Error ? cause.message : 'Could not disconnect.'; }
		finally { busy = false; }
	}
</script>

<section class="flex min-w-0 flex-col gap-2 border-b border-border pb-4" aria-labelledby={`${id}-title`}>
	<div class="flex flex-wrap items-center justify-between gap-2">
		<h3 id={`${id}-title`} class="m-0 text-sm font-medium">ChatGPT</h3>
		{#if connection?.authenticated || connection?.login}
			<Button variant="ghost" size="sm" loading={busy} disabled={disabled || busy} aria-label={connection.authenticated ? 'Disconnect ChatGPT' : 'Cancel ChatGPT sign-in'} onclick={disconnect}>
				{connection.authenticated ? 'Disconnect' : 'Cancel sign-in'}
			</Button>
		{:else}
			<Button variant="secondary" size="sm" loading={busy} disabled={disabled || busy || (!connection && refreshing)} aria-label="Sign in to ChatGPT" onclick={connect}>Sign in</Button>
		{/if}
	</div>
	<div class="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
		<div role="status" class="min-w-0 text-[13px] text-foreground-muted [overflow-wrap:anywhere]">
			{#if !connection}{refreshError ? 'Connection unavailable' : 'Checking connection...'}
			{:else if connection.authenticated}
				{#if connection.email}<span class="text-foreground">{connection.email}</span><span aria-hidden="true"> · </span>{/if}Connected
			{:else if connection.login}Waiting for sign-in
			{:else}Not connected{/if}
		</div>
		{#if connection?.authenticated}
			<Popover.Root placement="bottom-start">
				<Popover.Trigger variant="ghost" size="sm" class="min-h-6 px-2 text-xs" aria-label="Usage limits for ChatGPT" onopen={() => void refresh()}>Usage</Popover.Trigger>
				<Popover.Content class="w-[400px] max-w-[calc(100vw-2rem)]" surfaceClass="bg-muted p-0" aria-label="ChatGPT usage limits">
					<div class="max-h-[min(320px,60dvh)]">
						<ScrollArea aria-label="ChatGPT usage details" role="region" tabindex={0}>
							<div class="flex flex-col gap-4 p-4">
								<div class="flex flex-wrap items-center justify-between gap-2">
									<h4 class="m-0 text-sm font-medium">Usage</h4>
									<Button variant="ghost" size="sm" loading={refreshing} disabled={busy || refreshing} aria-label="Refresh ChatGPT usage" onclick={() => void refresh()}>Refresh</Button>
								</div>
								{#if refreshError || connection.error}
									<p class="m-0 text-xs text-error [overflow-wrap:anywhere]">Usage may be out of date. {refreshError || connection.error}</p>
								{/if}
								{#each limits as limit}
									{@const name = limitName(limit.name)}
									{@const percent = Number.isFinite(limit.usedPercent) ? Math.max(0, Math.min(100, limit.usedPercent)) : null}
									<div class="flex flex-col gap-2">
										<div class="flex items-baseline justify-between gap-3 text-xs">
											<div class="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
												<span class="font-medium [overflow-wrap:anywhere]">{name}</span>
												<span class="text-foreground-muted">{resetLabel(limit.resetsAt)}</span>
											</div>
											<span class="shrink-0 tabular-nums">{percent === null ? 'Unavailable' : `${Math.round(percent)}% used`}</span>
										</div>
										{#if percent !== null}
											<div role="meter" aria-label={`${name} usage`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-valuetext={`${Math.round(percent)}% used. ${resetLabel(limit.resetsAt)}`} class="h-1 overflow-hidden rounded-full bg-border">
												<div class="h-full rounded-full bg-info-vivid" style:width={`${percent}%`}></div>
											</div>
										{/if}
									</div>
								{:else}
									<p role="status" class="m-0 text-xs text-foreground-muted">{refreshing ? 'Loading usage...' : 'Usage limits are not available. Try refreshing.'}</p>
								{/each}
							</div>
						</ScrollArea>
					</div>
				</Popover.Content>
			</Popover.Root>
		{/if}
	</div>
	{#if connection?.login}
		<div class="flex flex-col gap-2">
			<p class="m-0 text-[13px]">Open the sign-in page and enter this code:</p>
			<code class="select-all self-start rounded border border-border px-3 py-2 text-base">{connection.login.userCode}</code>
			<a href={connection.login.verificationUrl} target="_blank" rel="noopener noreferrer" class="self-start text-sm underline underline-offset-4">Open ChatGPT sign-in ↗</a>
			<Button variant="ghost" size="sm" class="self-start" loading={refreshing} disabled={busy || refreshing} aria-label="Check ChatGPT sign-in status" onclick={() => void refresh()}>Check sign-in</Button>
		</div>
	{/if}
	{#if connection?.authenticated}
		<div class="flex flex-wrap items-center gap-2">
			<Select.Root value={selected}>
				<Select.Trigger class="min-w-0 flex-[1_1_12rem] justify-between" size="sm" variant="outline" disabled={disabled || busy || !models.length} aria-label={`ChatGPT model: ${selectedModel?.label ?? 'none selected'}`}>
					<span class="truncate">{selectedModel?.label ?? (refreshing ? 'Loading models...' : 'No models available')}</span>
				</Select.Trigger>
				<Select.Content>
					{#each models as model (model.id)}
						<Select.Item value={model.id} onclick={() => { if (!disabled && !busy) selected = model.id; }}>{model.label}</Select.Item>
					{/each}
				</Select.Content>
			</Select.Root>
			<Button variant="secondary" size="sm" disabled={disabled || !selectedModel || busy} aria-label={selectedModel ? `Add model ${selectedModel.label} from ChatGPT` : 'Add model from ChatGPT'} onclick={() => { if (!disabled && !busy && selectedModel) onAdd(selectedModel); }}>Add model</Button>
		</div>
		<p class="m-0 text-xs text-foreground-muted">Adds as the shared model. Role overrides stay unchanged.</p>
	{/if}
	{#if error || refreshError || connection?.error}
		<div class="flex flex-wrap items-center gap-2">
			<p class="m-0 min-w-0 text-xs text-error [overflow-wrap:anywhere]" role="alert">{error || refreshError || connection?.error}</p>
			{#if refreshError || connection?.error}
				<Button variant="ghost" size="sm" loading={refreshing} disabled={busy || refreshing} aria-label="Retry loading ChatGPT connection data" onclick={() => void refresh()}>Retry</Button>
			{/if}
		</div>
	{/if}
</section>
