<script lang="ts">
	import type { Tip } from '$lib/charts/tip';

	let { tip }: { tip: Tip | null } = $props();

	let element = $state<HTMLDivElement>();
	let left = $state(0);

	/** Keeps the tooltip inside its chart: centered on the point unless that would cross an edge. */
	$effect(() => {
		if (!tip || !element) return;

		const half = element.offsetWidth / 2;
		const room = element.parentElement?.clientWidth ?? Infinity;

		left = Math.min(Math.max(tip.x, half), Math.max(half, room - half));
	});
</script>

{#if tip}
	<div
		bind:this={element}
		class="chart-tip"
		role="tooltip"
		data-below={tip.below || undefined}
		style:left="{left || tip.x}px"
		style:top="{tip.y}px"
	>
		<div class="chart-tip-title">{tip.title}</div>
		{#each tip.rows as row, index (index)}
			<div class="chart-tip-row">
				<span class="chart-tip-label">
					{#if row.color}<span class="chart-swatch" style:background-color={row.color}></span>{/if}
					{row.label}
				</span>
				<span class="chart-tip-value">{row.value}</span>
			</div>
		{/each}
	</div>
{/if}
