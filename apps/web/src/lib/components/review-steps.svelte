<script lang="ts">
	import Check from '@lucide/svelte/icons/check';
	import CircleAlert from '@lucide/svelte/icons/circle-alert';
	import Pause from '@lucide/svelte/icons/pause';
	import Play from '@lucide/svelte/icons/play';
	import CircleStop from '@lucide/svelte/icons/circle-stop';
	import { Button } from '@sivir-ui/svelte/components/button';
	import * as Card from '@sivir-ui/svelte/components/card';
	import { Spinner } from '@sivir-ui/svelte/components/spinner';
	import * as Typography from '@sivir-ui/svelte/components/typography';

	interface Props {
		/** Index of the running step; equal to the step count when done. */
		current: number;
		failed?: boolean;
		active: boolean;
		elapsed: string;
		/** "4 of 6" progress for the specialist step. */
		specialists?: { done: number; total: number } | null;
		paused?: boolean;
		/** Present while the review runs. */
		onPauseToggle?: (() => Promise<void>) | null;
		onCancel?: (() => Promise<void>) | null;
	}
	let { current, failed = false, active, elapsed, specialists = null, paused = false, onPauseToggle = null, onCancel = null }: Props = $props();
	let pending = $state<'pause' | 'cancel' | null>(null);
	async function run(kind: 'pause' | 'cancel', action: (() => Promise<void>) | null): Promise<void> {
		if (!action || pending) return;
		pending = kind;
		try { await action(); } finally { pending = null; }
	}

	const steps = $derived([
		{ id: 'checkout', label: 'Prepare repository', meta: '' },
		{ id: 'plan', label: 'Plan review', meta: '' },
		{ id: 'checks', label: 'Run checks', meta: '' },
		{ id: 'specialists', label: 'Specialist reviews', meta: specialists?.total && current >= 3 ? `${specialists.done}/${specialists.total}` : '' },
		{ id: 'verify', label: 'Verify findings', meta: '' },
		{ id: 'consolidate', label: 'Consolidate findings', meta: '' }
	]);
	function statusOf(index: number): 'done' | 'active' | 'error' | 'pending' {
		if (index < current) return 'done';
		if (index > current) return 'pending';
		return failed ? 'error' : active ? 'active' : 'pending';
	}
	const liveLabel = $derived(active ? (paused ? 'Paused' : 'Live') : failed ? 'Stopped' : 'Finished');
</script>

<Card.Root class="rail-card rail-progress">
	<div class="rail-card-head">
		<Typography.Title level={2} class="rail-card-title">Progress</Typography.Title>
		<span class="review-live" data-live={(active && !paused) || undefined} data-paused={(active && paused) || undefined} data-failed={failed || undefined} role="timer" aria-label="{liveLabel}, {elapsed} elapsed">
			<span class="review-live-dot" aria-hidden="true"></span>{liveLabel} · {elapsed}
		</span>
	</div>
	<ol class="progress-steps" aria-label="Review progress">
		{#each steps as step, index (step.id)}
			{@const status = statusOf(index)}
			<li class="progress-step" data-status={status} aria-current={status === 'active' ? 'step' : undefined}>
				<span class="progress-mark" aria-hidden="true">
					{#if status === 'done'}<Check size={11} strokeWidth={2.5} />
					{:else if status === 'active'}<Spinner size={12} />
					{:else if status === 'error'}<CircleAlert size={12} />{/if}
				</span>
				<span class="progress-label">{step.label}</span>
				{#if step.meta}<span class="progress-meta">{step.meta}</span>{/if}
			</li>
		{/each}
	</ol>
	{#if active && (onPauseToggle || onCancel)}
		<div class="progress-controls">
			{#if onPauseToggle}
				<Button variant="ghost" class="progress-control" loading={pending === 'pause'} disabled={!!pending} onclick={() => void run('pause', onPauseToggle)}>
					{#if paused}<Play size={13} strokeWidth={1.75} aria-hidden="true" /> Resume{:else}<Pause size={13} strokeWidth={1.75} aria-hidden="true" /> Pause{/if}
				</Button>
			{/if}
			{#if onCancel}
				<Button variant="ghost" class="progress-control progress-cancel" loading={pending === 'cancel'} disabled={!!pending} onclick={() => void run('cancel', onCancel)}>
					<CircleStop size={13} strokeWidth={1.75} aria-hidden="true" /> Cancel
				</Button>
			{/if}
		</div>
	{/if}
</Card.Root>
