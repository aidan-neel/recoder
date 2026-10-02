<script lang="ts">
	import { normalizeModelMarkdown } from '@recoder/shared';
	import { Markdown } from '@sivir-ui/svelte/components/markdown';

	/** Sivir Markdown for model-written text, repaired first: small models get markdown syntax wrong. */
	let { content, streaming = false, class: className }: { content: string; streaming?: boolean; class?: string } = $props();
	const repaired = $derived(normalizeModelMarkdown(content, { complete: !streaming }));
</script>

<Markdown content={repaired} {streaming} class={className} />
