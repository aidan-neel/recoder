<script lang="ts">
	import { goto } from '$app/navigation';
	import { Button } from '@sivir-ui/svelte/components/button';
	import * as Card from '@sivir-ui/svelte/components/card';
	import { ScrollArea } from '@sivir-ui/svelte/components/scroll-area';
	import { Switch } from '@sivir-ui/svelte/components/switch';
	import ChartPanel from '$lib/components/charts/chart-panel.svelte';
	import XyChart from '$lib/components/charts/xy-chart.svelte';
	import ReportTable from '$lib/components/reports/report-table.svelte';
	import OptionSelect from '$lib/components/ui/option-select.svelte';
	import { configColors, configLegend, costPoints, finished, rankConfigs, trendPoints } from '$lib/reports/trend';

	let { data } = $props();

	const ALL = 'all';

	let config = $state(ALL);
	let dataset = $state(ALL);
	let hostId = $state(ALL);
	let partial = $state(false);
	let selected = $state<string[]>([]);

	const ranked = $derived(rankConfigs(data.reports));
	const colors = $derived(configColors(ranked));

	const configs = $derived(
		ranked.map((id) => ({ id, label: data.reports.find((entry) => entry.config.id === id)!.config.reviewer }))
	);
	const datasets = $derived([...new Set(data.reports.map((entry) => entry.dataset))].sort());
	const hosts = $derived([...new Map(data.reports.map((entry) => [entry.host, entry.hostLabel])).entries()]);

	const shown = $derived(
		data.reports.filter(
			(entry) =>
				(config === ALL || entry.config.id === config) &&
				(dataset === ALL || entry.dataset === dataset) &&
				(hostId === ALL || entry.host === hostId) &&
				(partial || finished(entry))
		)
	);

	function compare(): void {
		void goto(`/compare?${selected.map((key) => `r=${encodeURIComponent(key)}`).join('&')}`);
	}
</script>

<ScrollArea class="h-full min-h-0" aria-label="Reports" showCues={false}>
	<div class="bench-page">
		<div class="filter-row">
			<OptionSelect
				bind:value={config}
				label="Reviewer"
				class="min-w-[220px]"
				options={[
					{ value: ALL, label: 'Every reviewer' },
					...configs.map((item) => ({
						value: item.id,
						label: item.label,
						detail: `judge ${item.id.split('|')[1]}`,
						color: colors.get(item.id)
					}))
				]}
			/>
			<OptionSelect
				bind:value={dataset}
				label="Dataset"
				options={[{ value: ALL, label: 'Every dataset' }, ...datasets.map((name) => ({ value: name, label: name }))]}
			/>
			<OptionSelect
				bind:value={hostId}
				label="Host"
				options={[{ value: ALL, label: 'Every host' }, ...hosts.map(([id, name]) => ({ value: id, label: name }))]}
			/>
			<Switch bind:checked={partial} label="Partial runs" />
			<span class="flex-1"></span>
			<Button variant="outline" disabled={selected.length < 2} onclick={compare}>
				Compare{selected.length ? ` ${selected.length}` : ''}
			</Button>
		</div>

		<div class="bench-grid">
			<ChartPanel title="Recall over time" legend={configLegend(shown, ranked)}>
				{#if shown.length}
					<XyChart points={trendPoints(shown, ranked)} label="Recall of each report over time" lines time />
				{:else}
					<p class="bench-empty">No report matches.</p>
				{/if}
			</ChartPanel>
			<ChartPanel title="Recall against time per review" legend={configLegend(shown, ranked)}>
				{#if shown.length}
					<XyChart
						points={costPoints(shown, ranked)}
						label="Recall of each report against its minutes per review"
						xFormat={(value) => `${value}m`}
					/>
				{:else}
					<p class="bench-empty">No report matches.</p>
				{/if}
			</ChartPanel>
		</div>

		<Card.Root class="bench-panel">
			<div class="bench-panel-head">
				<h3 class="bench-panel-title">{shown.length} of {data.reports.length} reports</h3>
				<div class="bench-panel-tools">
					<span class="bench-note">Pick two to four to compare.</span>
				</div>
			</div>
			{#if shown.length}
				<div class="bench-table-wrap">
					<ReportTable entries={shown} colorOf={(entry) => colors.get(entry.config.id)} bind:selected />
				</div>
			{:else}
				<p class="bench-empty">No report matches.</p>
			{/if}
		</Card.Root>
	</div>
</ScrollArea>
