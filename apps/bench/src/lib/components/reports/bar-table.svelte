<script lang="ts">
	import type { BarRow } from '$lib/charts/types';

	let { rows, series = ['Value'] }: { rows: BarRow[]; series?: string[] } = $props();
</script>

<table class="bench-table">
	<thead>
		<tr>
			<th>Group</th>
			{#each series as name (name)}<th data-num>{name}</th><th data-num>Count</th>{/each}
		</tr>
	</thead>
	<tbody>
		{#each rows as row (row.key)}
			<tr>
				<td
					>{row.label}{#if row.sub}<span class="bar-row-sub">{row.sub}</span>{/if}</td
				>
				{#each series as _, index (index)}
					<td data-num>{row.values[index]?.text ?? '–'}</td>
					<td data-num data-faint>{row.values[index]?.detail ?? ''}</td>
				{/each}
			</tr>
		{/each}
	</tbody>
</table>
