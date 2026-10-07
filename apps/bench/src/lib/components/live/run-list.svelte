<script lang="ts">
	import * as Card from '@sivir-ui/svelte/components/card';
	import type { ActiveRun } from '$lib/reports/types';
	import RunRow from './run-row.svelte';

	let { runs }: { runs: ActiveRun[] } = $props();
</script>

<Card.Root class="bench-panel">
	{#if runs.length}
		<ul class="run-list">
			{#each runs as run (run.key)}
				<RunRow {run} />
			{/each}
		</ul>
	{:else}
		<p class="bench-empty">No benchmark is running.</p>
	{/if}
</Card.Root>
