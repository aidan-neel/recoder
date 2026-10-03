<script lang="ts">
	import Check from '@lucide/svelte/icons/check';
	import CircleAlert from '@lucide/svelte/icons/circle-alert';
	import * as Card from '@sivir-ui/svelte/components/card';
	import { Spinner } from '@sivir-ui/svelte/components/spinner';
	import * as Typography from '@sivir-ui/svelte/components/typography';
	import { STAGE } from '$lib/review/review-progress-state';
	import type { AgentCounts } from '$lib/review/reviewing-view';

	interface Props {
		/** Index of the running step (`STAGE`); `STAGE.done` when finished. */
		current: number;
		failed?: boolean;
		active: boolean;
		elapsed: string;
		/** One reviewer per review unit. */
		reviewers?: AgentCounts | null;
		/** The subagents reviewers asked for; the step is hidden when none ran. */
		subagents?: AgentCounts | null;
		paused?: boolean;
	}

	let {
		current,
		failed = false,
		active,
		elapsed,
		reviewers = null,
		subagents = null,
		paused = false
	}: Props = $props();

	/** "3/4 · 1 failed", once the step has started. */
	function countsMeta(counts: AgentCounts | null, stage: number): string {
		if (!counts?.total || current < stage) return '';

		return `${counts.done}/${counts.total}${counts.failed ? ` · ${counts.failed} failed` : ''}`;
	}

	const steps = $derived([
		{ label: 'Prepare repository', meta: '', counts: null },
		{ label: 'Understand changes', meta: '', counts: null },
		{ label: 'Run checks', meta: '', counts: null },
		{ label: 'Reviewing', meta: countsMeta(reviewers, STAGE.reviewing), counts: reviewers },
		{ label: 'Subagents', meta: countsMeta(subagents, STAGE.subagents), counts: subagents },
		{ label: 'Verify findings', meta: '', counts: null },
		{ label: 'Consolidate findings', meta: '', counts: null }
	]);

	/** A passed step of agents with some of them failed is `partial`: it ran, but not all of it. */
	function statusOf(index: number): 'done' | 'partial' | 'active' | 'error' | 'pending' {
		if (index < current) return steps[index].counts?.failed ? 'partial' : 'done';
		if (index > current) return 'pending';

		return failed ? 'error' : active ? 'active' : 'pending';
	}

	const liveLabel = $derived(active ? (paused ? 'Paused' : 'Live') : failed ? 'Stopped' : 'Finished');
</script>

<Card.Root class="rail-card rail-progress">
	<div class="rail-card-head">
		<Typography.Title level={2} class="rail-card-title">Progress</Typography.Title>
		<span
			class="review-live"
			data-live={(active && !paused) || undefined}
			data-paused={(active && paused) || undefined}
			data-failed={failed || undefined}
			role="timer"
			aria-label="{liveLabel}, {elapsed} elapsed"
		>
			<span class="review-live-dot" aria-hidden="true"></span>{liveLabel} · {elapsed}
		</span>
	</div>
	<ol class="progress-steps" aria-label="Review progress">
		{#each steps as step, index (step.label)}
			{@const status = statusOf(index)}
			{#if index !== STAGE.subagents || subagents?.total}
				<li class="progress-step" data-status={status} aria-current={status === 'active' ? 'step' : undefined}>
					<span class="progress-mark" aria-hidden="true">
						{#if status === 'done'}<Check size={11} strokeWidth={2.5} />
						{:else if status === 'active'}<Spinner size={12} />
						{:else if status === 'error' || status === 'partial'}<CircleAlert size={12} />{/if}
					</span>
					<span class="progress-label">{step.label}</span>
					{#if step.meta}<span class="progress-meta">{step.meta}</span>{/if}
				</li>
			{/if}
		{/each}
	</ol>
</Card.Root>
