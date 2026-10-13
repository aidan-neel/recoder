<script lang="ts">
	import LayoutList from '@lucide/svelte/icons/layout-list';
	import Check from '@lucide/svelte/icons/check';
	import ChangeMap from './change-map.svelte';
	import StatusGlyph from '../ui/status-glyph.svelte';
	import { hoverHighlight } from '$web/shell/hover-highlight';
	import { decisionGlyph, plain, where } from '$lib/review/labels';
	import type { ReviewState, Selection } from '$lib/review/review-state.svelte';

	interface Props {
		view: ReviewState;
	}

	let { view }: Props = $props();

	const surface = $derived(view.surface!);

	let rail = $state<HTMLElement>();

	/** Keep the selected row in view when the keyboard moves it. */
	$effect(() => {
		void view.selection;
		rail?.querySelector('[data-selected="true"]')?.scrollIntoView({ block: 'nearest' });
	});

	const rowProps = (selection: Selection) => ({
		'data-selected': view.isSelected(selection),
		'aria-current': view.isSelected(selection) ? ('true' as const) : undefined,
		onclick: () => view.select(selection)
	});
</script>

<nav class="rail thin-scroll" aria-label="Review" bind:this={rail} {@attach hoverHighlight({ items: '.rail-row' })}>
	<button class="rail-row rail-overview" type="button" {...rowProps({ kind: 'overview' })}>
		<LayoutList size={15} class="rail-icon" aria-hidden="true" />
		<span class="rail-main">
			<span class="rail-title">Overview</span>
			<ChangeMap attention={surface.attention} legend={false} class="rail-map" />
		</span>
	</button>

	{#if view.running && surface.decisions.length === 0}
		<h2 class="rail-heading">Needs you <span class="rail-count shimmer-text">reviewing</span></h2>
		{#each [78, 62, 70] as width, index (index)}
			<div class="rail-row-skeleton" aria-hidden="true">
				<span class="skeleton" style:width="{width}%" style:height="11px"></span>
			</div>
		{/each}
	{:else if surface.decisions.length}
		<h2 class="rail-heading">
			Needs you
			<span class="rail-count tabular">{view.open.length ? `${view.open.length} open` : 'all decided'}</span>
		</h2>
		{#each surface.decisions as decision (decision.id)}
			{@const kind = decisionGlyph(decision, view.decisions.stateOf(decision.id))}
			<button
				class="rail-row"
				type="button"
				data-decided={kind !== decision.tone}
				{...rowProps({ kind: 'decision', id: decision.id })}
			>
				<StatusGlyph {kind} class="rail-glyph" />
				<span class="rail-main">
					<span class="rail-title">{plain(decision.title)}</span>
					<span class="rail-meta mono">{where(decision.file, decision.line, null, true)}</span>
				</span>
			</button>
		{/each}
	{/if}

	{#if surface.receipts.length}
		<h2 class="rail-heading">Checked for you <span class="rail-count tabular">{surface.receipts.length}</span></h2>
		{#each surface.receipts as receipt (receipt.id)}
			<button class="rail-row rail-receipt" type="button" {...rowProps({ kind: 'receipt', id: receipt.id })}>
				<span class="rail-check" aria-hidden="true"><Check size={12} strokeWidth={2.25} /></span>
				<span class="rail-main">
					<span class="rail-title">{plain(receipt.question)}</span>
				</span>
			</button>
		{/each}
	{/if}

	{#if surface.files.length}
		<h2 class="rail-heading">Files <span class="rail-count tabular">{surface.files.length}</span></h2>
		{#each surface.files as file (file.path)}
			{@const slash = file.path.lastIndexOf('/') + 1}
			<button class="rail-row rail-file" type="button" {...rowProps({ kind: 'file', path: file.path })}>
				<span class="rail-swatch" data-cls={file.cls} aria-hidden="true"></span>
				<span class="rail-file-path mono"
					><span class="rail-file-dir">{file.path.slice(0, slash)}</span>{file.path.slice(slash)}</span
				>
				<span class="rail-file-stat mono tabular">{file.cls === 'read' ? file.readLines : ''}</span>
			</button>
		{/each}
	{/if}
</nav>
