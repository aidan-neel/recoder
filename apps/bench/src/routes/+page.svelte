<script lang="ts">
	import { onMount } from 'svelte';
	import { Button } from '@sivir-ui/svelte/components/button';
	import * as Card from '@sivir-ui/svelte/components/card';
	import { ScrollArea } from '@sivir-ui/svelte/components/scroll-area';
	import ChartPanel from '$lib/components/charts/chart-panel.svelte';
	import StatTile from '$lib/components/charts/stat-tile.svelte';
	import XyChart from '$lib/components/charts/xy-chart.svelte';
	import HostCards from '$lib/components/live/host-cards.svelte';
	import RunList from '$lib/components/live/run-list.svelte';
	import ReportTable from '$lib/components/reports/report-table.svelte';
	import * as Alert from '@sivir-ui/svelte/components/alert';
	import { LIVE, poll } from '$lib/live/poll';
	import { settled } from '$lib/live/settled.svelte';
	import { labeledPrecision, minutes, percent, recall, shortDate } from '$lib/reports/stats';
	import { configColors, configLegend, finished, rankConfigs, trendPoints } from '$lib/reports/trend';

	let { data } = $props();

	onMount(() => poll(LIVE, 10_000));

	const live = settled(() => data.live);

	const ranked = $derived(rankConfigs(data.reports));
	const colors = $derived(configColors(ranked));
	const latest = $derived(data.reports.find(finished) ?? null);
</script>

<ScrollArea class="h-full min-h-0" aria-label="Overview" showCues={false}>
	<div class="bench-page">
		<section class="bench-section">
			<h2 class="bench-section-title">Hosts</h2>
			{#if live.error}
				<Alert.Root variant="error"><Alert.Description>{live.error}</Alert.Description></Alert.Root>
			{:else}
				<HostCards hosts={live.current?.hosts} />
			{/if}
		</section>

		<section class="bench-section">
			<div class="bench-head">
				<h2 class="bench-section-title">Active runs</h2>
				<Button href="/new" variant="outline">New run</Button>
			</div>
			<RunList runs={live.current?.runs} />
		</section>

		{#if latest}
			<section class="bench-section">
				<div class="bench-head">
					<h2 class="bench-section-title">Latest finished report</h2>
					<Button href="/reports/{latest.key}" variant="ghost">{latest.dataset} · {shortDate(latest.startedAt)}</Button>
				</div>
				<div class="stat-tiles">
					<StatTile
						label="Recall"
						value={percent(recall(latest.overall))}
						detail="{latest.overall.found}/{latest.overall.planted} defects"
					/>
					<StatTile
						label="Bugs"
						value={percent(recall(latest.byKind.bug))}
						detail="{latest.byKind.bug?.found ?? 0}/{latest.byKind.bug?.planted ?? 0}"
					/>
					<StatTile
						label="Quality"
						value={percent(recall(latest.byKind.quality))}
						detail="{latest.byKind.quality?.found ?? 0}/{latest.byKind.quality?.planted ?? 0}"
					/>
					<StatTile
						label="Labeled findings"
						value={percent(labeledPrecision(latest.findings, latest.unlabeled))}
						detail="{latest.findings - latest.unlabeled}/{latest.findings} report a defect"
					/>
					<StatTile
						label="Per review"
						value={latest.meanReviewMinutes === null ? '–' : minutes(latest.meanReviewMinutes * 60_000)}
						detail="{latest.runsPassed} reviews passed"
					/>
					<StatTile label="Lost in verification" value={String(latest.lost)} detail="found only by hidden candidates" />
				</div>
			</section>
		{/if}

		<section class="bench-section">
			<h2 class="bench-section-title">Recall over time</h2>
			<ChartPanel title="Every report, by reviewer" legend={configLegend(data.reports, ranked)}>
				{#if data.reports.length}
					<XyChart
						points={trendPoints(data.reports, ranked)}
						label="Recall of each report over time, colored by reviewer"
						lines
						time
						height={280}
					/>
					<p class="bench-note mt-3">
						Rings are partial runs. Scores compare only within one reviewer and judge. One or two defects of change is
						noise.
					</p>
				{:else}
					<p class="bench-empty">No reports yet.</p>
				{/if}
			</ChartPanel>
		</section>

		<section class="bench-section">
			<div class="bench-head">
				<h2 class="bench-section-title">Recent reports</h2>
				<Button href="/reports" variant="ghost">All reports</Button>
			</div>
			<Card.Root class="bench-panel">
				{#if data.reports.length}
					<div class="bench-table-wrap">
						<ReportTable entries={data.reports.slice(0, 8)} colorOf={(entry) => colors.get(entry.config.id)} />
					</div>
				{:else}
					<p class="bench-empty">No reports yet.</p>
				{/if}
			</Card.Root>
		</section>
	</div>
</ScrollArea>
