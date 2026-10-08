<script lang="ts">
	import type { Tip } from '$lib/charts/tip';
	import { tipOver } from '$lib/charts/tip';
	import type { Segment, StackRow } from '$lib/charts/types';
	import ChartTip from './chart-tip.svelte';

	let { rows }: { rows: StackRow[] } = $props();

	let frame = $state<HTMLDivElement>();
	let active = $state<string | null>(null);
	let tip = $state<Tip | null>(null);

	function total(row: StackRow): number {
		return row.segments.reduce((sum, segment) => sum + segment.value, 0);
	}

	function show(row: StackRow, segment: Segment, target: EventTarget | null): void {
		if (!frame || !(target instanceof Element)) return;

		const all = total(row);

		active = `${row.key}:${segment.key}`;

		tip = tipOver(frame, target, rows.length > 1 ? `${segment.label} · ${row.label}` : segment.label, [
			{ label: 'Count', value: String(segment.value), color: segment.color },
			{ label: 'Share', value: all ? `${Math.round((segment.value / all) * 100)}%` : '–' }
		]);
	}

	function hide(): void {
		active = null;
		tip = null;
	}
</script>

<div class="chart" bind:this={frame}>
	<div class="stack-rows" data-hovering={active ? true : undefined}>
		{#each rows as row (row.key)}
			{@const all = total(row)}
			<div>
				{#if rows.length > 1}<div class="stack-row-label">{row.label}</div>{/if}
				<div
					class="stack-bar"
					role="img"
					aria-label="{row.label}: {row.segments.map((s) => `${s.label} ${s.value}`).join(', ')}"
				>
					{#if all === 0}
						<div class="stack-seg flex-1 rounded bg-raised"></div>
					{/if}
					{#each row.segments.filter((segment) => segment.value > 0) as segment (segment.key)}
						<div
							class="stack-seg"
							role="presentation"
							data-active={active === `${row.key}:${segment.key}` || undefined}
							style:flex-grow={segment.value}
							style:background-color={segment.color}
							onpointerenter={(event) => show(row, segment, event.currentTarget)}
							onpointerleave={hide}
						></div>
					{/each}
				</div>
			</div>
		{/each}
	</div>
	<ChartTip {tip} />
</div>
