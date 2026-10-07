<script lang="ts">
	import type { DefectGroup } from '$lib/charts/types';

	let { groups }: { groups: DefectGroup[] } = $props();
</script>

<table class="bench-table">
	<thead>
		<tr><th>PR</th><th>Defect</th><th>Each run</th></tr>
	</thead>
	<tbody>
		{#each groups as group (group.pr)}
			{#each group.defects as defect (defect.id)}
				<tr>
					<td data-mono class="whitespace-nowrap">{group.pr}</td>
					<td data-wrap>{defect.title} <span class="font-mono text-[11px] text-fg-faint">{defect.sub}</span></td>
					<td data-mono>{defect.cells.map((cell) => cell.stage).join(', ')}</td>
				</tr>
			{/each}
		{/each}
	</tbody>
</table>
