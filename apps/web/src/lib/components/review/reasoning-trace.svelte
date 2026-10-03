<script lang="ts">
	import { ScrollArea } from '@sivir-ui/svelte/components/scroll-area';
	import { reasoningMarkdown } from '$lib/review/reasoning-text';
	import StreamingMarkdown from './streaming-markdown.svelte';

	/** One reasoning trace in a height-capped box that follows new thinking unless the reader scrolled up. */
	let { text, streaming = false }: { text: string; streaming?: boolean } = $props();

	let viewport = $state<HTMLDivElement>();
	let pinned = true;

	$effect(() => {
		const el = viewport;

		if (!el || !streaming) return;

		const follow = () => {
			if (pinned) el.scrollTop = el.scrollHeight;
		};

		follow();

		const ro = new ResizeObserver(follow);

		for (const child of Array.from(el.children)) ro.observe(child);

		return () => ro.disconnect();
	});
</script>

<ScrollArea
	bind:element={viewport}
	orientation="vertical"
	showCues={false}
	class="reasoning-trace"
	onscroll={() => {
		if (viewport) pinned = viewport.scrollTop + viewport.clientHeight >= viewport.scrollHeight - 24;
	}}
>
	<StreamingMarkdown content={reasoningMarkdown(text)} {streaming} />
</ScrollArea>
