<script lang="ts">
	import { goto } from '$app/navigation';
	import * as Alert from '@sivir-ui/svelte/components/alert';
	import { Button } from '@sivir-ui/svelte/components/button';
	import { ScrollArea } from '@sivir-ui/svelte/components/scroll-area';
	import { seriesColor } from '$lib/charts/series';
	import BarRows from '$lib/components/charts/bar-rows.svelte';
	import ChartPanel from '$lib/components/charts/chart-panel.svelte';
	import StackedBars from '$lib/components/charts/stacked-bars.svelte';
	import BarTable from '$lib/components/reports/bar-table.svelte';
	import ReportTable from '$lib/components/reports/report-table.svelte';
	import { finished } from '$lib/reports/trend';

	let { data } = $props();

	let selected = $state<string[]>([]);

	const view = $derived(data.view);
	const series = $derived(view?.legend ?? []);
	const names = $derived(series.map((item) => item.label));
	const candidates = $derived(data.reports.filter(finished).slice(0, 30));

	function compare(): void {
		void goto(`/compare?${selected.map((key) => `r=${encodeURIComponent(key)}`).join('&')}`);
	}

	function pickColor(entry: { key: string }): string | undefined {
		const index = view?.entries.findIndex((item) => item.key === entry.key) ?? -1;

		return index >= 0 ? seriesColor(index) : undefined;
	}
</script>

<ScrollArea class="h-full min-h-0" aria-label="Compare" showCues={false}>
	<div class="bench-page">
		{#if !view}
			<div class="bench-head">
				<h1 class="bench-title">Compare</h1>
				<Button variant="outline" disabled={selected.length < 2} onclick={compare}>
					Compare{selected.length ? ` ${selected.length}` : ''}
				</Button>
			</div>
			<ChartPanel title="Pick two to four finished reports" flush>
				<div class="bench-table-wrap">
					<ReportTable entries={candidates} colorOf={() => 'var(--series-other)'} bind:selected />
				</div>
			</ChartPanel>
		{:else}
			<div class="bench-head">
				<h1 class="bench-title">Compare {view.entries.length} reports</h1>
				<Button href="/compare" variant="ghost">Pick others</Button>
			</div>

			{#if view.warnings.length}
				<Alert.Root variant="warning">
					{#each view.warnings as warning (warning)}
						<Alert.Description>{warning}</Alert.Description>
					{/each}
				</Alert.Root>
			{/if}

			<ChartPanel title="Reports" flush>
				<div class="bench-table-wrap"><ReportTable entries={view.entries} colorOf={pickColor} /></div>
			</ChartPanel>

			<div class="bench-grid">
				<ChartPanel title="Recall by kind" legend={series}>
					<BarRows rows={view.kinds} {series} />
					{#snippet table()}<BarTable rows={view.kinds} series={names} />{/snippet}
				</ChartPanel>
				<ChartPanel title="Recall by codebase" legend={series}>
					<BarRows rows={view.codebases} {series} />
					{#snippet table()}<BarTable rows={view.codebases} series={names} />{/snippet}
				</ChartPanel>
				<ChartPanel title="Recall by category" legend={series} wide>
					<BarRows rows={view.categories} {series} />
					{#snippet table()}<BarTable rows={view.categories} series={names} />{/snippet}
				</ChartPanel>
				<ChartPanel title="Recall by PR" legend={series} wide>
					<BarRows rows={view.prs} {series} />
					{#snippet table()}<BarTable rows={view.prs} series={names} />{/snippet}
				</ChartPanel>
				{#if view.classes.length}
					<ChartPanel
						title="What the findings are"
						legend={view.classes[0]!.segments.map((segment) => ({ label: segment.label, color: segment.color }))}
						wide
					>
						<StackedBars rows={view.classes} />
					</ChartPanel>
				{/if}
			</div>
		{/if}
	</div>
</ScrollArea>
