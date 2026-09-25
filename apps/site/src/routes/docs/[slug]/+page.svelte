<script lang="ts">
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import ArrowRight from '@lucide/svelte/icons/arrow-right';
	import { Button } from '@sivir-ui/svelte/components/button';
	import { Markdown } from '@sivir-ui/svelte/components/markdown';
	import * as Typography from '@sivir-ui/svelte/components/typography';
	import { docBySlug } from '$lib/docs';

	let { data } = $props();
	const doc = $derived(docBySlug(data.slug)!);
</script>

<svelte:head>
	<title>{doc.title} · Recoder docs</title>
	<meta name="description" content={doc.body.split('\n')[0]} />
	<link rel="canonical" href={`https://recoder.dev/docs/${doc.slug}`} />
</svelte:head>

{#key doc.slug}
	<article class="docs-column">
		<Typography.Title level={1} class="docs-title enter-rise" style="--i: 0">{doc.title}</Typography.Title>
		<div class="docs-prose enter-rise" style="--i: 1">
			<Markdown content={doc.body} />
		</div>
		<nav class="docs-pager enter-rise" style="--i: 2" aria-label="Docs pages">
			{#if data.previous}
				<Button href={`/docs/${data.previous.slug}`} variant="ghost">
					<ArrowLeft size={14} aria-hidden="true" />
					{data.previous.title}
				</Button>
			{/if}
			{#if data.next}
				<Button href={`/docs/${data.next.slug}`} variant="ghost" class="ml-auto">
					{data.next.title}
					<ArrowRight size={14} aria-hidden="true" />
				</Button>
			{/if}
		</nav>
	</article>
{/key}
