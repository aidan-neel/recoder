<script lang="ts">
	import type { PrCheck } from '@recoder/shared';
	import { untrack } from 'svelte';
	import Check from '@lucide/svelte/icons/check';
	import CircleDashed from '@lucide/svelte/icons/circle-dashed';
	import RefreshCw from '@lucide/svelte/icons/refresh-cw';
	import X from '@lucide/svelte/icons/x';
	import { Button } from '@sivir-ui/svelte/components/button';
	import * as Popover from '@sivir-ui/svelte/components/popover';
	import { Spinner } from '@sivir-ui/svelte/components/spinner';
	import CheckList from './check-list.svelte';
	import { serverApi } from '$lib/server-api';

	/** The pull request's CI checks: a summary button with the list in a popover. Polls while any run. */
	let { reviewId }: { reviewId: string } = $props();
	let checks = $state<PrCheck[] | null>(null);
	let ref = $state('');
	/** GitLab runs pipelines: summarize as one pass/fail instead of counting jobs. */
	let pipeline = $state(false);
	let error = $state<string | null>(null);
	let loading = $state(false);

	const failed = $derived((checks ?? []).filter((c) => c.state === 'failed').length);
	const active = $derived((checks ?? []).filter((c) => c.state === 'running' || c.state === 'pending').length);
	const passed = $derived((checks ?? []).filter((c) => c.state === 'passed').length);
	const tone = $derived(!checks ? 'idle' : failed ? 'failed' : active ? 'running' : checks.length ? 'passed' : 'idle');

	async function load(): Promise<void> {
		if (loading) return;
		loading = true;
		try {
			const result = await serverApi.getChecks(reviewId);
			checks = result.checks;
			ref = result.ref;
			pipeline = result.provider === 'gitlab';
			error = null;
		} catch (e) {
			error = e instanceof Error ? e.message : 'Could not load checks.';
		} finally {
			loading = false;
		}
	}

	$effect(() => {
		void reviewId;
		// Untracked: load() reads and writes its own state.
		untrack(() => {
			checks = null;
			void load();
		});
		const timer = setInterval(() => { if (active) void load(); }, 20_000);
		return () => clearInterval(timer);
	});
</script>

{#if checks === null && !error}
	<span class="pr-checks-pending" aria-label="Loading checks"><Spinner size={12} aria-hidden="true" /></span>
{:else}
	<Popover.Root placement="bottom-end">
		<Popover.Trigger variant="ghost" class="pr-checks" data-tone={tone} aria-label={pipeline ? 'Merge request pipeline' : 'Pull request checks'}>
			{#if pipeline}
				{#if error}<CircleDashed size={14} aria-hidden="true" />Pipeline
				{:else if tone === 'failed'}<X size={14} aria-hidden="true" />Pipeline failing
				{:else if tone === 'running'}<Spinner size={12} aria-hidden="true" />Pipeline running
				{:else if tone === 'passed'}<Check size={14} aria-hidden="true" />Pipeline passing
				{:else}<CircleDashed size={14} aria-hidden="true" />No pipeline{/if}
			{:else if error}<CircleDashed size={14} aria-hidden="true" />Checks
			{:else if tone === 'failed'}<X size={14} aria-hidden="true" />{failed} failing
			{:else if tone === 'running'}<Spinner size={12} aria-hidden="true" />{active} running
			{:else if tone === 'passed'}<Check size={14} aria-hidden="true" />{passed}/{checks?.length} checks
			{:else}<CircleDashed size={14} aria-hidden="true" />No checks{/if}
		</Popover.Trigger>
		<Popover.Content class="w-[22rem] max-w-[calc(100vw-2rem)]" surfaceClass="!gap-2 !p-3">
			<div class="pr-checks-head">
				<Popover.Title class="text-[13px] font-medium">{pipeline ? 'Pipeline' : 'Checks'}</Popover.Title>
				{#if ref}<code class="pr-checks-ref" title={ref}>{ref}</code>{/if}
				<Button variant="ghost" size="icon" class="pr-checks-refresh" aria-label="Refresh checks" disabled={loading} onclick={() => void load()}><RefreshCw size={13} aria-hidden="true" /></Button>
			</div>
			{#if error}<p class="pr-checks-empty">{error}</p>
			{:else if checks?.length}<CheckList {checks} />
			{:else}<p class="pr-checks-empty">{pipeline ? "No pipeline has run on this merge request's latest commit." : "No checks have run on this pull request's latest commit."}</p>{/if}
		</Popover.Content>
	</Popover.Root>
{/if}
