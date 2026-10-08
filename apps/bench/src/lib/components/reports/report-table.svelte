<script lang="ts">
	import { Checkbox } from '@sivir-ui/svelte/components/checkbox';
	import { labeledPrecision, minutes, percent, recall, shortDate } from '$lib/reports/stats';
	import { finished } from '$lib/reports/trend';
	import type { ReportEntry } from '$lib/reports/types';

	let {
		entries,
		colorOf,
		selected = $bindable(),
		limit = 4
	}: {
		entries: ReportEntry[];
		/** The dot beside each reviewer: its config's color on the list, its pick order on Compare. */
		colorOf: (entry: ReportEntry) => string | undefined;
		/** Report keys picked for Compare; omit to hide the picks. */
		selected?: string[];
		limit?: number;
	} = $props();

	function toggle(key: string, on: boolean): void {
		if (!selected) return;

		selected = on ? [...selected, key].slice(-limit) : selected.filter((item) => item !== key);
	}
</script>

<table class="bench-table">
	<thead>
		<tr>
			{#if selected}<th><span class="sr-only">Compare</span></th>{/if}
			<th>Started</th>
			<th>Reviewer and judge</th>
			<th>PRs</th>
			<th data-num>Runs</th>
			<th data-num>Recall</th>
			<th data-num>Bugs</th>
			<th data-num>Quality</th>
			<th data-num title="Shown findings that report a planted defect">Labeled</th>
			<th data-num>Per review</th>
			<th>Host</th>
		</tr>
	</thead>
	<tbody>
		{#each entries as entry (entry.key)}
			<tr>
				{#if selected}
					<td class="w-8">
						<Checkbox
							checked={selected.includes(entry.key)}
							aria-label="Compare {entry.dataset} {shortDate(entry.startedAt)}"
							onCheckedChange={(on) => toggle(entry.key, on)}
						/>
					</td>
				{/if}
				<td data-mono class="whitespace-nowrap"><a href="/reports/{entry.key}">{shortDate(entry.startedAt)}</a></td>
				<td data-wrap>
					<span class="flex items-center gap-2">
						<span class="chart-swatch" data-shape="dot" style:background-color={colorOf(entry)}></span>
						{entry.config.reviewer}
					</span>
					<span class="block pl-4 font-mono text-[11px] text-fg-faint">judge {entry.config.judge}</span>
				</td>
				<td data-mono class="whitespace-nowrap">
					{entry.dataset}
					<span class="block text-fg-faint">{entry.prIds.length} × {entry.runsPerPr}</span>
				</td>
				<td data-num>
					{entry.runsPassed}/{entry.runsExpected}
					{#if entry.runsFailed}<span class="block text-danger">{entry.runsFailed} failed</span>{/if}
					{#if !finished(entry)}<span class="block" data-faint>partial</span>{/if}
				</td>
				<td data-num>
					{percent(recall(entry.overall))}
					<span class="block" data-faint>{entry.overall.found}/{entry.overall.planted}</span>
				</td>
				<td data-num>{percent(recall(entry.byKind.bug))}</td>
				<td data-num>{percent(recall(entry.byKind.quality))}</td>
				<td data-num>{percent(labeledPrecision(entry.findings, entry.unlabeled))}</td>
				<td data-num>{entry.meanReviewMinutes === null ? '–' : minutes(entry.meanReviewMinutes * 60_000)}</td>
				<td data-faint class="whitespace-nowrap">{entry.hostLabel}</td>
			</tr>
		{/each}
	</tbody>
</table>
