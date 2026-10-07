<script lang="ts">
	import type { Tip, TipRow } from '$lib/charts/tip';
	import { tipOver } from '$lib/charts/tip';
	import type { BarRow, BarValue, Series } from '$lib/charts/types';
	import ChartTip from './chart-tip.svelte';

	let {
		rows,
		series = [{ label: 'Recall', color: 'var(--series-1)' }],
		max = 1,
		extra = []
	}: {
		rows: BarRow[];
		series?: Series[];
		/** The value a full-width bar stands for. */
		max?: number;
		/** More tooltip lines per row key. */
		extra?: [string, TipRow[]][];
	} = $props();

	let frame = $state<HTMLDivElement>();
	let active = $state<string | null>(null);
	let tip = $state<Tip | null>(null);

	const more = $derived(new Map(extra));

	function show(row: BarRow, target: EventTarget | null): void {
		if (!frame || !(target instanceof Element)) return;

		active = row.key;

		tip = tipOver(frame, target, row.sub ? `${row.label} · ${row.sub}` : row.label, [
			...row.values.flatMap((value, index) =>
				value
					? [
							{
								label: series[index]?.label ?? '',
								value: value.detail ? `${value.text} · ${value.detail}` : value.text,
								color: series[index]?.color
							}
						]
					: [{ label: series[index]?.label ?? '', value: 'none', color: series[index]?.color }]
			),
			...(more.get(row.key) ?? [])
		]);
	}

	function hide(): void {
		active = null;
		tip = null;
	}

	function width(value: BarValue | null): string {
		return value ? `${Math.max(0, Math.min(1, value.value / (max || 1))) * 100}%` : '0%';
	}
</script>

<div class="chart" bind:this={frame}>
	<div class="bar-rows" data-hovering={active ? true : undefined} role="list">
		{#each rows as row (row.key)}
			<div
				class="bar-row"
				role="listitem"
				data-active={active === row.key || undefined}
				onpointerenter={(event) => show(row, event.currentTarget.querySelector('.bar-stack'))}
				onpointerleave={hide}
			>
				<span class="bar-row-label" title={row.label}>
					{row.label}{#if row.sub}<span class="bar-row-sub">{row.sub}</span>{/if}
				</span>
				<div class="bar-stack" data-many={series.length > 1 || undefined}>
					{#each row.values as value, index (index)}
						<div class="bar-track">
							<div class="bar-fill" style:width={width(value)} style:background-color={series[index]?.color}></div>
						</div>
					{/each}
				</div>
				<span class="bar-row-value">
					{#each row.values as value, index (index)}
						<span data-faint={!value || undefined}
							>{value?.text ?? '–'}{#if value?.detail}<span class="bar-row-sub">{value.detail}</span>{/if}</span
						>
					{/each}
				</span>
			</div>
		{/each}
	</div>
	<ChartTip {tip} />
</div>
