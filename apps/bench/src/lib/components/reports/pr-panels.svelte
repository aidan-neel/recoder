<script lang="ts">
	import BarRows from '$lib/components/charts/bar-rows.svelte';
	import ChartPanel from '$lib/components/charts/chart-panel.svelte';
	import DefectGrid from '$lib/components/charts/defect-grid.svelte';
	import { STAGE_LEGEND, type ReportView } from '$lib/reports/detail';
	import BarTable from './bar-table.svelte';
	import DefectTable from './defect-table.svelte';

	let { view }: { view: ReportView } = $props();
</script>

<ChartPanel title="Recall by PR" wide>
	<BarRows rows={view.prs} extra={view.prExtra} />
	{#snippet table()}<BarTable rows={view.prs} />{/snippet}
</ChartPanel>

<ChartPanel title="Planted defects by run" legend={STAGE_LEGEND} wide>
	{#if view.defects.length}
		<DefectGrid groups={view.defects} runs={view.runs} />
	{:else}
		<p class="bench-empty">No planted defects.</p>
	{/if}
	{#snippet table()}<DefectTable groups={view.defects} />{/snippet}
</ChartPanel>
