<script lang="ts">
	import { Spinner } from '@sivir-ui/svelte/components/spinner';
	import * as Typography from '@sivir-ui/svelte/components/typography';
	import ReviewChangeFacts from './review-change-facts.svelte';
	import type { ReviewingMeta } from '$lib/review/reviewing-view';
	import { STAGE } from '$lib/review/review-progress-state';

	/** Checkout and dependency install have no transcript of their own; until the orchestrator speaks, this card stands in. */
	let {
		meta,
		stage,
		stageDetail,
		setupMessage
	}: {
		meta: ReviewingMeta;
		/** 0 while checking out the pull request, later while setting up the environment. */
		stage: number;
		stageDetail?: string;
		setupMessage?: string;
	} = $props();
</script>

<div class="focus-empty review-preparing" data-kind="running" role="status">
	<div class="focus-empty-card">
		<span class="focus-empty-icon" aria-hidden="true"><Spinner size={18} /></span>
		<Typography.Title level={2} class="focus-empty-title"
			>{stage === STAGE.checkout ? 'Checking out the pull request' : 'Setting up the environment'}</Typography.Title
		>
		<p class="focus-empty-text">
			{(stage === STAGE.checkout ? stageDetail : setupMessage) ||
				(stage === STAGE.checkout
					? 'Fetching the branch and preparing an isolated checkout.'
					: 'Installing dependencies so the review can run code.')}
		</p>
		<ReviewChangeFacts {meta} />
	</div>
	<div class="focus-empty-ghosts" data-shimmer aria-hidden="true">
		{#each [0, 1, 2] as i (i)}
			<div class="focus-empty-ghost" style="--i: {i}">
				<span class="focus-empty-ghost-line" style="width: {[34, 28, 40][i]}%"></span>
				<span class="focus-empty-ghost-line is-faint" style="width: {[86, 64, 78][i]}%"></span>
			</div>
		{/each}
	</div>
</div>
