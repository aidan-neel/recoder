<script lang="ts">
	import type { Tip } from '$lib/charts/tip';
	import { tipOver } from '$lib/charts/tip';
	import type { CellStage, DefectGroup, DefectRow } from '$lib/charts/types';
	import ChartTip from './chart-tip.svelte';

	let { groups, runs }: { groups: DefectGroup[]; runs: number } = $props();

	const STAGE_TEXT: Record<CellStage, string> = {
		published: 'Published',
		verified: 'Verified, not published',
		found: 'Raised, dropped',
		missed: 'Missed',
		none: 'No score'
	};

	let frame = $state<HTMLDivElement>();
	let tip = $state<Tip | null>(null);

	function show(defect: DefectRow, run: number, target: EventTarget | null): void {
		const cell = defect.cells[run];

		if (!frame || !cell || !(target instanceof Element)) return;

		tip = tipOver(frame, target, defect.title, [
			{ label: `Run ${run + 1}`, value: STAGE_TEXT[cell.stage] },
			...cell.rows
		]);
	}
</script>

<div class="chart" bind:this={frame}>
	<div
		class="defect-grid"
		style:grid-template-columns="minmax(0, 1fr) repeat({runs}, 16px)"
		role="img"
		aria-label="Planted defects by run; the table view lists the same data"
	>
		{#each groups as group (group.pr)}
			<div class="defect-grid-pr">{group.pr}</div>
			{#each group.defects as defect (defect.id)}
				<div class="defect-grid-label" title={defect.title}><span>{defect.sub}</span>{defect.title}</div>
				{#each defect.cells as cell, run (run)}
					<div
						class="defect-cell"
						role="presentation"
						data-stage={cell.stage}
						onpointerenter={(event) => show(defect, run, event.currentTarget)}
						onpointerleave={() => (tip = null)}
					></div>
				{/each}
				{#each Array(Math.max(0, runs - defect.cells.length)) as _, index (index)}
					<div class="defect-cell" data-stage="none"></div>
				{/each}
			{/each}
		{/each}
	</div>
	<ChartTip {tip} />
</div>
