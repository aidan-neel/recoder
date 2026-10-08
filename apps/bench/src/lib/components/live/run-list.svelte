<script lang="ts">
	import * as Card from '@sivir-ui/svelte/components/card';
	import Skeleton from '$web/components/ui/skeleton.svelte';
	import type { ActiveRun } from '$lib/reports/types';
	import RunRow from './run-row.svelte';

	/** Undefined while the runs load. */
	let { runs }: { runs: ActiveRun[] | undefined } = $props();
</script>

<Card.Root class="bench-panel">
	{#if !runs}
		<div class="run-list">
			<div class="run-row-main run-skeleton">
				<Skeleton class="h-[13.5px] w-56" />
				<Skeleton class="h-[11px] w-80" />
			</div>
		</div>
	{:else if runs.length}
		<ul class="run-list">
			{#each runs as run (run.key)}
				<RunRow {run} />
			{/each}
		</ul>
	{:else}
		<p class="bench-empty">No benchmark is running.</p>
	{/if}
</Card.Root>
