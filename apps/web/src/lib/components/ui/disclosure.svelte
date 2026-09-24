<script lang="ts">
	import type { Snippet } from 'svelte';
	import Check from '@lucide/svelte/icons/check';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import CircleAlert from '@lucide/svelte/icons/circle-alert';
	import { Spinner } from '@sivir-ui/svelte/components/spinner';
	import { anchorToggle } from '$lib/scroll-anchor';

	/**
	 * Transcript disclosure: status glyph, label, optional meta, chevron; the body
	 * sits behind a left rail. Replaces Sivir Collapsible/Tool in the chat, which
	 * unmounted their body on close and slid a measured height (the jitter).
	 * Here the body mounts on first open and stays mounted, and the open/close is
	 * a CSS grid-rows transition, so streaming content just grows.
	 */
	let {
		open = $bindable(false),
		status,
		size = 'md',
		label,
		meta,
		children,
		title,
		class: className = '',
		bodyClass = ''
	}: {
		open?: boolean;
		/** Leading glyph. `running` also shimmers the label. */
		status?: 'running' | 'done' | 'error';
		/** `md` section header, `sm` nested detail, `row` full-width tool row. */
		size?: 'md' | 'sm' | 'row';
		label: Snippet;
		/** Right of the label in mono, e.g. a duration. */
		meta?: string;
		children?: Snippet;
		title?: string;
		class?: string;
		bodyClass?: string;
	} = $props();

	const id = $props.id();
	let opened = $state(false);
	$effect.pre(() => {
		if (open) opened = true;
	});
	const mounted = $derived(open || opened);
	let panelEl = $state<HTMLElement>();
</script>

<div class="disclosure {className}" data-size={size} data-status={status} data-open={open || undefined}>
	<button
		type="button"
		class="disclosure-trigger"
		aria-expanded={children ? open : undefined}
		aria-controls={children ? `${id}-panel` : undefined}
		disabled={!children}
		{title}
		onclick={(event) => {
			anchorToggle(event.currentTarget, !open, () => panelEl);
			open = !open;
		}}
	>
		{#if status}
			<span class="disclosure-glyph" aria-hidden="true">
				{#if status === 'running'}<Spinner size={size === 'md' ? 13 : 12} />
				{:else if status === 'error'}<CircleAlert size={size === 'md' ? 14 : 12} />
				{:else}<Check size={size === 'md' ? 14 : 12} />{/if}
			</span>
		{/if}
		<span class="disclosure-label" class:shimmer-text={status === 'running'}>{@render label()}</span>
		{#if meta}<span class="disclosure-meta">{meta}</span>{/if}
		{#if children}<ChevronRight size={size === 'md' ? 14 : 12} class="disclosure-chevron" aria-hidden="true" />{/if}
	</button>
	{#if children}
		<div id="{id}-panel" class="disclosure-panel" inert={!open} bind:this={panelEl}>
			<div class="disclosure-clip">
				<div class="disclosure-body {bodyClass}">
					{#if mounted}{@render children()}{/if}
				</div>
			</div>
		</div>
	{/if}
</div>
