<script lang="ts">
	import DotLoader from './dot-loader.svelte';

	/**
	 * "Thinking 3.2s" that settles into "Thought for 3.2s": the words crossfade
	 * through a slight blur, the timer glides to its new spot and freezes, and
	 * the dot grid folds away. Keep it mounted across the change to see it.
	 */
	let { working, time }: { working: boolean; time?: string } = $props();

	let workWidth = $state(0);
	let doneWidth = $state(0);
	const shift = $derived((working ? workWidth : doneWidth) - Math.max(workWidth, doneWidth));
</script>

<span class="thought-label" data-working={working || undefined}>
	<span class="thought-label-glyph"><DotLoader /></span>
	<span class="thought-label-stack">
		<span class="thought-label-text shimmer-text" data-active={working || undefined} bind:offsetWidth={workWidth}>Thinking</span>
		<span class="thought-label-text" data-active={!working || undefined} bind:offsetWidth={doneWidth}>{time ? 'Thought for' : 'Thought'}</span>
	</span>
	{#if time}<span class="thought-label-time" style:transform="translateX({shift}px)">{time}</span>{/if}
</span>
