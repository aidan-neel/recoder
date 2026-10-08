<script lang="ts">
	import type { LegendItem } from '$lib/charts/types';

	let { items }: { items: LegendItem[] } = $props();
</script>

<ul class="chart-legend m-0 list-none p-0" aria-label="Legend">
	{#each items as item (item.label)}
		<li class="chart-legend-item">
			<span
				class="chart-swatch"
				data-shape={item.shape ?? 'square'}
				style:background-color={item.color}
				style:color={item.color}
			></span>
			<span class="truncate">{item.label}</span>
		</li>
	{/each}
</ul>
