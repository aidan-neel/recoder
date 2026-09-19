<script lang="ts">
	import type { ReviewToolCall } from '@recoder/shared';
	import * as Tool from '@sivir-ui/svelte/components/tool';
	import { CodeBlock } from '@sivir-ui/svelte/components/code-block';
	import { ScrollArea } from '@sivir-ui/svelte/components/scroll-area';
	import * as Typography from '@sivir-ui/svelte/components/typography';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import * as Collapsible from '@sivir-ui/svelte/components/collapsible';
	import { Spinner } from '@sivir-ui/svelte/components/spinner';
	import { toolPresentation } from '$lib/review-transcript';

	let { tool, duration, active }: { tool: ReviewToolCall; duration: string; active: boolean } = $props();
	const interrupted = $derived(tool.status === 'running' && !active);
	const presentation = $derived(toolPresentation(tool));
	const action = $derived(presentation.action);
	const actionLabel = $derived(action === 'readDiff' ? 'Read diff' : ['readFile', 'read'].includes(action) ? 'Read file' : ['search', 'rg'].includes(action) ? 'Search' : ['listFiles', 'list'].includes(action) ? 'List files' : 'Run tool');
	const target = $derived(presentation.target || 'Details unavailable');
</script>

<Tool.Root
	name={presentation.name}
	state={tool.status === 'done' ? 'complete' : interrupted ? 'error' : tool.status}
	variant="quiet"
	{duration}
	open={false}
	class="review-tool-disclosure min-w-0"
>
	{#snippet trigger({ open })}
		<span class="shrink-0 text-sm">{actionLabel}</span>
		<span class="min-w-0 truncate font-mono text-xs" title={target}>{target}</span>
		{#if tool.status === 'running' && active}<Spinner size={12} class="shrink-0" aria-hidden="true" />{/if}
		{#if tool.status === 'error' || interrupted}<span class="shrink-0 text-xs text-error">{interrupted ? 'Interrupted' : 'Failed'}</span>{/if}
		<ChevronRight size={13} aria-hidden="true" class="shrink-0 {open ? 'rotate-90' : ''}" />
	{/snippet}
	<div class="min-w-0 space-y-3 py-2">
		<ScrollArea style="max-height: min(24rem, 50dvh)" aria-label="Tool details" showCues={false}>
			{#if tool.result?.content}
				<CodeBlock code={tool.result.content} lang={action === 'readDiff' ? 'diff' : 'plaintext'} copy="overlay" class="rounded-lg ![--code-block-max-height:none]" />
			{:else}
				<Typography.Text class="break-words text-sm text-foreground-muted">
					{tool.result?.error || tool.summary || (interrupted ? 'The review ended before this operation finished.' : tool.status === 'running' ? 'Retrieving evidence…' : 'No output was recorded.')}
				</Typography.Text>
			{/if}
			{#if tool.result?.truncated}
				<Typography.Text class="mt-2 text-xs text-foreground-muted">Showing a truncated evidence preview.</Typography.Text>
			{/if}
			{#if tool.result?.evidenceId}
				<Typography.Text class="mt-2 font-mono text-xs text-foreground-muted">{tool.result.evidenceId}{tool.result.revision ? ` · ${tool.result.revision}` : ''}</Typography.Text>
			{/if}
		</ScrollArea>
		<div class="flex flex-wrap items-start gap-x-4 gap-y-2">
			{#if duration}<Typography.Metadata class="pt-1 font-mono text-xs tabular-nums">{duration}</Typography.Metadata>{/if}
			{#if tool.input}
				<Collapsible.Root>
					<Collapsible.Trigger class="review-disclosure !text-xs">Input <ChevronRight size={12} aria-hidden="true" /></Collapsible.Trigger>
					<Collapsible.Content class="w-full py-2">
						<Typography.Text class="whitespace-pre-wrap break-all font-mono text-xs text-foreground-muted">{JSON.stringify(tool.input, null, 2)}</Typography.Text>
					</Collapsible.Content>
				</Collapsible.Root>
			{/if}
		</div>
	</div>
</Tool.Root>
