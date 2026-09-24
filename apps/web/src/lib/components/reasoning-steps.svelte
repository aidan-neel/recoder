<script lang="ts">
	import type { ReviewReasoningEntry } from '@recoder/shared';
	import { Markdown } from '@sivir-ui/svelte/components/markdown';
	import * as Typography from '@sivir-ui/svelte/components/typography';

	/**
	 * Reasoning summaries as quiet step rows. Providers send `**Heading**`
	 * paragraphs (often with no body); each heading becomes a plain row and any
	 * prose under it stays as muted markdown, so nothing renders as a bold wall.
	 */
	let { entries, live = false }: { entries: ReviewReasoningEntry[]; live?: boolean } = $props();

	type Step = { key: string; title: string | null; body: string; streaming: boolean };
	const HEADING = /^\*\*([^*\n]+?)\*\*[.:]?$/;

	const steps = $derived(entries.flatMap((entry) => {
		const out: Step[] = [];
		const streaming = live && entry.status === 'streaming';
		for (const [i, paragraph] of entry.text.split(/\n\s*\n/).map((part) => part.trim()).filter(Boolean).entries()) {
			const heading = HEADING.exec(paragraph);
			const last = out.at(-1);
			if (heading) out.push({ key: `${entry.id}:${i}`, title: heading[1].trim(), body: '', streaming: false });
			else if (last && !last.body) last.body = paragraph;
			else out.push({ key: `${entry.id}:${i}`, title: null, body: paragraph, streaming: false });
		}
		const tail = out.at(-1);
		if (tail) tail.streaming = streaming;
		return out;
	}));
</script>

{#if steps.length}
	<div class="reasoning-steps">
		{#each steps as step (step.key)}
			<div class="reasoning-step" data-streaming={step.streaming || undefined}>
				{#if step.title}<Typography.Text class="reasoning-step-title {step.streaming && !step.body ? 'shimmer-text' : ''}" title={step.title}>{step.title}</Typography.Text>{/if}
				{#if step.body}<Markdown content={step.body} streaming={step.streaming} />{/if}
			</div>
		{/each}
	</div>
{/if}
