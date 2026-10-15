<script lang="ts">
	import type { Snippet } from 'svelte';
	import * as FileDiff from '@sivir-ui/svelte/components/file-diff';
	import type { ExcerptLine } from '$lib/review/excerpt';
	import { langForPath } from '$web/findings/evidence';

	interface Props {
		path: string;
		lines: ExcerptLine[];
		/** Lines left out before and after, shown as quiet gaps. */
		above?: number;
		below?: number;
		/** Right side of the header: a range, an action. */
		aside?: Snippet;
		/** Extra rows after a line, such as the decisions that end on it. */
		annotate?: Snippet<[ExcerptLine]>;
		class?: string;
	}

	let { path, lines, above = 0, below = 0, aside, annotate, class: className = '' }: Props = $props();

	const TYPE = { add: 'add', del: 'remove', context: 'context' } as const;
	const slash = $derived(path.lastIndexOf('/') + 1);

	/** In a new file every line is an addition, so the green tint carries no information. */
	const fresh = $derived(lines.length > 0 && lines.every(({ line }) => line.type === 'add'));
</script>

{#snippet gap(count: number)}
	<FileDiff.Row class="code-gap">
		<span class="code-gap-label">{count} more line{count === 1 ? '' : 's'}</span>
	</FileDiff.Row>
{/snippet}

<FileDiff.Root class="code-view {className}" file={path} lang={langForPath(path)} data-new={fresh || undefined}>
	<FileDiff.TopBar class="code-head">
		<span class="code-path mono"><span class="code-dir">{path.slice(0, slash)}</span>{path.slice(slash)}</span>
		{#if fresh}<span class="code-new">New file</span>{/if}
		<span class="flex-1"></span>
		{@render aside?.()}
	</FileDiff.TopBar>
	<FileDiff.Content class="code-body thin-scroll">
		{#if above > 0}{@render gap(above)}{/if}
		{#each lines as item, index (index)}
			<FileDiff.Row
				type={TYPE[item.line.type]}
				oldLine={item.line.oldNo}
				newLine={item.line.newNo}
				code={item.line.text}
				data-flagged={item.flagged || undefined}
			/>
			{@render annotate?.(item)}
		{/each}
		{#if below > 0}{@render gap(below)}{/if}
	</FileDiff.Content>
</FileDiff.Root>
