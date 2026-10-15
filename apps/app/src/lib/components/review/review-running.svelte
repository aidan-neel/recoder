<script lang="ts">
	import type { ReviewState } from '$lib/review/review-state.svelte';

	interface Props {
		view: ReviewState;
	}

	let { view }: Props = $props();

	const share = $derived(
		view.progress && view.progress.tasksTotal > 0 ? view.progress.tasksDone / view.progress.tasksTotal : 0
	);
</script>

<div class="running">
	<h2 class="overview-lead">
		<span class="shimmer-text">Reviewing this pull request.</span>
		<span class="overview-lead-rest"
			>Decisions appear here as reviewers confirm them; you can start before it finishes.</span
		>
	</h2>
	<div class="running-meter" role="progressbar" aria-valuemin={0} aria-valuemax={1} aria-valuenow={share}>
		<span style:scale="{share} 1"></span>
	</div>
	{#if view.progress}
		<p class="running-note tabular">{view.progress.tasksDone} of {view.progress.tasksTotal} steps done</p>
	{/if}
</div>
