<script lang="ts">
	import { ScrollArea } from '@sivir-ui/svelte/components/scroll-area';
	import { reasoningMarkdown } from '$lib/review/reasoning-text';
	import { followOutput } from '$lib/shell/follow-output';
	import StreamingMarkdown from './streaming-markdown.svelte';

	/** One reasoning trace in a height-capped box that follows new thinking unless the reader scrolled up. */
	let { text, streaming = false }: { text: string; streaming?: boolean } = $props();

	let viewport = $state<HTMLDivElement>();

	$effect(() => {
		if (viewport && streaming) return followOutput(viewport);
	});
</script>

<ScrollArea bind:element={viewport} orientation="vertical" showCues={false} class="reasoning-trace">
	<StreamingMarkdown content={reasoningMarkdown(text)} {streaming} />
</ScrollArea>
