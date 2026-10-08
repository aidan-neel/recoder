<script lang="ts">
	import { Button } from '@sivir-ui/svelte/components/button';
	import { ScrollArea } from '@sivir-ui/svelte/components/scroll-area';
	import BarRows from '$lib/components/charts/bar-rows.svelte';
	import ChartPanel from '$lib/components/charts/chart-panel.svelte';
	import StackedBars from '$lib/components/charts/stacked-bars.svelte';
	import StatTile from '$lib/components/charts/stat-tile.svelte';
	import XyChart from '$lib/components/charts/xy-chart.svelte';
	import BarTable from '$lib/components/reports/bar-table.svelte';
	import PrPanels from '$lib/components/reports/pr-panels.svelte';
	import { labeledPrecision, minutes, percent, recall, shortDate } from '$lib/reports/stats';

	let { data } = $props();

	const view = $derived(data.view);
	const entry = $derived(view.entry);
</script>

<ScrollArea class="h-full min-h-0" aria-label="Report" showCues={false}>
	<div class="bench-page">
		<div class="bench-head">
			<div class="min-w-0">
				<h1 class="bench-title">{entry.config.reviewer}</h1>
				<div class="bench-meta">
					<span>judge <b>{entry.config.judge}</b></span>
					<span>{entry.dataset} <b>{entry.prIds.length} PRs × {entry.runsPerPr}</b></span>
					<span>{shortDate(entry.startedAt)} → {view.finished ? shortDate(entry.finishedAt) : 'partial'}</span>
					<span>{entry.hostLabel} <b>{view.base}</b></span>
					{#if entry.harnessCommit}<span>harness <b>{entry.harnessCommit.slice(0, 8)}</b></span>{/if}
					{#if entry.reviewer}<span>subagents <b>{entry.reviewer.subagentCap}</b></span>{/if}
				</div>
			</div>
			<Button href="/compare?r={encodeURIComponent(entry.key)}" variant="outline">Compare</Button>
		</div>

		<div class="stat-tiles" data-cols="4">
			<StatTile
				label="Recall"
				value={percent(recall(entry.overall))}
				detail="{entry.overall.found}/{entry.overall.planted} defects"
			/>
			<StatTile
				label="Bugs"
				value={percent(recall(entry.byKind.bug))}
				detail="{entry.byKind.bug?.found ?? 0}/{entry.byKind.bug?.planted ?? 0}"
			/>
			<StatTile
				label="Quality"
				value={percent(recall(entry.byKind.quality))}
				detail="{entry.byKind.quality?.found ?? 0}/{entry.byKind.quality?.planted ?? 0}"
			/>
			<StatTile
				label="Labeled findings"
				value={percent(labeledPrecision(entry.findings, entry.unlabeled))}
				detail="{entry.findings - entry.unlabeled}/{entry.findings} report a defect"
			/>
			<StatTile
				label="Findings per run"
				value={entry.runsPassed ? (entry.findings / entry.runsPassed).toFixed(1) : '–'}
				detail="{entry.runsPassed}/{entry.runsExpected} runs passed"
			/>
			<StatTile
				label="Per review"
				value={entry.meanReviewMinutes === null ? '–' : minutes(entry.meanReviewMinutes * 60_000)}
				detail="mean of passed runs"
			/>
			<StatTile
				label="Lost in verification"
				value={String(view.hidden.lost)}
				detail="{view.hidden.matched}/{view.hidden.candidates} hidden match"
			/>
			<StatTile
				label="Stability"
				value={percent(entry.defectStability)}
				detail={entry.defectStability === null ? 'one run a PR' : 'found in every run'}
			/>
		</div>

		<div class="bench-grid">
			<ChartPanel title="Recall by kind">
				<BarRows rows={view.kinds} />
				{#snippet table()}<BarTable rows={view.kinds} />{/snippet}
			</ChartPanel>
			<ChartPanel title="Recall by codebase">
				<BarRows rows={view.codebases} />
				{#snippet table()}<BarTable rows={view.codebases} />{/snippet}
			</ChartPanel>
			<ChartPanel title="Recall by category" wide>
				<BarRows rows={view.categories} />
				{#snippet table()}<BarTable rows={view.categories} />{/snippet}
			</ChartPanel>
			<PrPanels {view} />

			<ChartPanel title="How far defects got">
				{#if view.stages}
					<BarRows rows={view.stages} />
				{:else}
					<p class="bench-empty">This report kept no candidates.</p>
				{/if}
				{#snippet table()}<BarTable rows={view.stages ?? []} />{/snippet}
			</ChartPanel>
			<ChartPanel title="Where found defects stopped">
				{#if view.stoppedAt.length}
					<BarRows rows={view.stoppedAt} series={[{ label: 'Defects', color: 'var(--series-2)' }]} />
				{:else}
					<p class="bench-empty">Every found defect was published.</p>
				{/if}
				{#snippet table()}<BarTable rows={view.stoppedAt} />{/snippet}
			</ChartPanel>

			<ChartPanel
				title="What the findings are"
				legend={view.classes[0]?.segments.map((s) => ({ label: s.label, color: s.color }))}
			>
				{#if view.classes.length}
					<StackedBars rows={view.classes} />
					<p class="bench-note mt-3">Not adjudicated findings may be real issues the generator did not plant.</p>
				{:else}
					<p class="bench-empty">No labels.</p>
				{/if}
			</ChartPanel>
			<ChartPanel title="Review funnel, mean per run">
				{#if view.funnel.length}
					<BarRows rows={view.funnel} series={[{ label: 'Candidates', color: 'var(--series-3)' }]} />
				{:else}
					<p class="bench-empty">The server did not count candidates.</p>
				{/if}
				{#snippet table()}<BarTable rows={view.funnel} />{/snippet}
			</ChartPanel>

			<ChartPanel
				title="Time per review"
				legend={[
					{ label: 'Passed', color: 'var(--series-1)', shape: 'dot' },
					{ label: 'Failed or timed out', color: 'var(--danger)', shape: 'ring' }
				]}
				wide
			>
				<XyChart
					points={view.durations.points}
					categories={view.durations.categories}
					label="Minutes each review took, by PR"
					xFormat={(value) => `${value}m`}
				/>
			</ChartPanel>
		</div>

		{#if view.missed.length}
			<section class="bench-section">
				<h2 class="bench-section-title">Missed defects</h2>
				<ChartPanel
					title={view.missed.length === 1
						? 'One defect missed in a run'
						: `${view.missed.length} defects missed in a run`}
					flush
				>
					<div class="bench-table-wrap">
						<table class="bench-table">
							<thead>
								<tr>
									<th>PR</th>
									<th>Defect</th>
									<th>Kind</th>
									<th data-num>Found</th>
									<th>Stopped at</th>
									<th>Judge</th>
								</tr>
							</thead>
							<tbody>
								{#each view.missed as defect (`${defect.pr}/${defect.id}`)}
									<tr>
										<td data-mono class="whitespace-nowrap">{defect.pr}</td>
										<td data-wrap>
											{defect.title}
											<span class="block font-mono text-[11px] text-fg-faint">{defect.where}</span>
										</td>
										<td class="whitespace-nowrap"
											>{defect.kind} <span class="block text-fg-faint">{defect.category}</span></td
										>
										<td data-num>{defect.found}/{defect.scored}</td>
										<td class="whitespace-nowrap">{defect.stoppedAt ?? '–'}</td>
										<td data-wrap class="text-fg-muted">{defect.reason ?? '–'}</td>
									</tr>
								{/each}
							</tbody>
						</table>
					</div>
				</ChartPanel>
			</section>
		{/if}

		{#if view.failed.length}
			<section class="bench-section">
				<h2 class="bench-section-title">Runs without a score</h2>
				<ChartPanel title={view.failed.length === 1 ? 'One run' : `${view.failed.length} runs`} flush>
					<div class="bench-table-wrap">
						<table class="bench-table">
							<thead>
								<tr><th>PR</th><th data-num>Run</th><th>Outcome</th><th data-num>Time</th><th>Why</th></tr>
							</thead>
							<tbody>
								{#each view.failed as run (`${run.pr}#${run.run}`)}
									<tr>
										<td data-mono>{run.pr}</td>
										<td data-num>{run.run}</td>
										<td class="text-danger">{run.outcome}</td>
										<td data-num>{run.minutes}</td>
										<td data-wrap class="text-fg-muted">{run.why || '–'}</td>
									</tr>
								{/each}
							</tbody>
						</table>
					</div>
				</ChartPanel>
			</section>
		{/if}
	</div>
</ScrollArea>
