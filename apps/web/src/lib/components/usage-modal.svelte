<script lang="ts">
	import { untrack } from 'svelte';
	import RefreshCw from '@lucide/svelte/icons/refresh-cw';
	import * as Alert from '@sivir-ui/svelte/components/alert';
	import { Button } from '@sivir-ui/svelte/components/button';
	import * as Modal from '@sivir-ui/svelte/components/modal';
	import { Progress } from '@sivir-ui/svelte/components/progress';
	import * as Typography from '@sivir-ui/svelte/components/typography';
	import type { CodexConnection } from '@recoder/shared';
	import UsageSkeleton from './usage-skeleton.svelte';
	import { modelSettingsUi } from '$lib/model-settings.svelte';
	import { serverApi } from '$lib/server-api';
	import { shellState } from '$lib/shell-state.svelte';

	let connection = $state<CodexConnection | null>(null);
	let loading = $state(false);
	let error = $state<string | null>(null);
	let now = $state(Date.now());

	$effect(() => {
		if (shellState.usageOpen) untrack(() => void refresh());
	});

	async function refresh(): Promise<void> {
		if (loading) return;
		loading = true;
		error = null;
		now = Date.now();
		try {
			connection = await serverApi.getCodexStatus();
			void shellState.refreshUsage();
		} catch (e) {
			error = e instanceof Error ? e.message : 'Could not load usage.';
		} finally {
			loading = false;
		}
	}

	function limitName(name: string): string {
		return name.replace(/\b(\d+)\s+min\b/gi, (match, value: string) => {
			const minutes = Number(value);
			if (minutes === 10080) return 'Weekly';
			if (minutes > 0 && minutes % 1440 === 0) return `${minutes / 1440}-day`;
			if (minutes > 0 && minutes % 60 === 0) return `${minutes / 60}-hour window`;
			return match;
		});
	}

	function resetText(resetsAt: number | null): string {
		if (!resetsAt || !Number.isFinite(resetsAt)) return 'Reset time unavailable';
		const minutes = Math.ceil((resetsAt * 1000 - now) / 60_000);
		if (minutes <= 0) return 'Resetting now';
		const at = new Date(resetsAt * 1000);
		const when =
			minutes < 24 * 60
				? at.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
				: at.toLocaleDateString(undefined, { weekday: 'long', hour: 'numeric', minute: '2-digit' });
		const h = Math.floor(minutes / 60);
		const rel = minutes < 60 ? `${minutes}m` : h < 24 ? `${h}h ${minutes % 60}m` : `${Math.floor(h / 24)}d ${h % 24}h`;
		return `Resets in ${rel} · ${when}`;
	}

	function planName(plan: string): string {
		return plan
			.replace(/lite$/i, ' lite')
			.split(/[\s_-]+/)
			.map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
			.join(' ');
	}
</script>

<Modal.Root bind:open={shellState.usageOpen}>
	<Modal.Content size="md" class="usage-modal" aria-label="ChatGPT usage">
		<Modal.Header>
			<Modal.Title>Usage</Modal.Title>
		</Modal.Header>
		<Modal.Body class="gap-5">
			{#if error}
				<Alert.Root variant="error">
					<Alert.Title>Could not load usage</Alert.Title>
					<Alert.Description>{error}</Alert.Description>
				</Alert.Root>
			{:else if !connection}
				<UsageSkeleton label="Loading usage" />
			{:else if !connection.authenticated}
				<Typography.Text variant="supporting">Sign in to ChatGPT in Settings to review with your plan and track its limits here.</Typography.Text>
			{:else}
				<Typography.Text class="usage-account">
					{connection.email ?? 'ChatGPT'}{#if connection.planType}<span class="mx-1.5 text-fg-faint" aria-hidden="true">·</span>{planName(connection.planType)}{/if}
				</Typography.Text>
				<div class="flex flex-col gap-4">
					{#each connection.limits ?? [] as limit (limit.name)}
						{@const name = limitName(limit.name)}
						{@const percent = Number.isFinite(limit.usedPercent) ? Math.max(0, Math.min(100, Math.round(limit.usedPercent))) : null}
						<div class="flex flex-col gap-2">
							<div class="flex items-baseline justify-between gap-3">
								<span class="text-[13px] text-fg">{name}</span>
								<span class="font-mono text-[12.5px] text-fg-muted tabular-nums">{percent === null ? '—' : `${percent}% used`}</span>
							</div>
							{#if percent !== null}
								<Progress value={percent} class="usage-bar" {...{ 'aria-label': `${name} usage` }} />
							{/if}
							<span class="text-[12px] text-fg-faint">{resetText(limit.resetsAt)}</span>
						</div>
					{:else}
						<Typography.Text variant="supporting">ChatGPT didn't report any limits for this plan.</Typography.Text>
					{/each}
				</div>
			{/if}
		</Modal.Body>
		<Modal.Footer>
			<Button variant="ghost" class="mr-auto" loading={loading} disabled={loading} onclick={() => void refresh()}>
				<RefreshCw size={14} aria-hidden="true" /> Refresh
			</Button>
			<Button
				variant="ghost"
				onclick={() => {
					shellState.usageOpen = false;
					modelSettingsUi.show('models');
				}}
			>
				Model settings
			</Button>
			<Modal.Close variant="primary" class="mr-0">Done</Modal.Close>
		</Modal.Footer>
	</Modal.Content>
</Modal.Root>
