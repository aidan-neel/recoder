<script lang="ts">
	import type { Snippet } from 'svelte';
	import * as Card from '@sivir-ui/svelte/components/card';
	import * as Tabs from '@sivir-ui/svelte/components/tabs';
	import type { LegendItem } from '$lib/charts/types';
	import Legend from './legend.svelte';

	let {
		title,
		legend = [],
		wide = false,
		flush = false,
		tools,
		table,
		children
	}: {
		title: string;
		legend?: LegendItem[];
		wide?: boolean;
		/** Drops the body padding, for a table that runs to the panel's edges. */
		flush?: boolean;
		tools?: Snippet;
		/** The same data as a table; the panel then offers a Chart and Table switch. */
		table?: Snippet;
		children: Snippet;
	} = $props();

	let view = $state('chart');
</script>

<Card.Root class="bench-panel" data-wide={wide || undefined}>
	<div class="bench-panel-head">
		<h3 class="bench-panel-title">{title}</h3>
		<div class="bench-panel-tools">
			{@render tools?.()}
			{#if table}
				<Tabs.Root bind:value={view} variant="segmented" class="bench-view-tabs shrink-0">
					<Tabs.List {...{ 'aria-label': `${title} view` }}>
						<Tabs.Trigger value="chart">Chart</Tabs.Trigger>
						<Tabs.Trigger value="table">Table</Tabs.Trigger>
					</Tabs.List>
				</Tabs.Root>
			{/if}
		</div>
	</div>
	{#if view === 'table' && table}
		<div class="bench-panel-body" data-flush>
			<div class="bench-table-wrap">{@render table()}</div>
		</div>
	{:else}
		<div class="bench-panel-body" data-flush={flush || undefined}>
			{#if legend.length > 1}<div class="mb-4"><Legend items={legend} /></div>{/if}
			{@render children()}
		</div>
	{/if}
</Card.Root>
