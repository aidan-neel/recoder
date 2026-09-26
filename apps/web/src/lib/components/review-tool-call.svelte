<script lang="ts">
	import type { ReviewToolCall } from '@recoder/shared';
	import { CodeBlock } from '@sivir-ui/svelte/components/code-block';
	import { ScrollArea } from '@sivir-ui/svelte/components/scroll-area';
	import * as Typography from '@sivir-ui/svelte/components/typography';
	import { Spinner } from '@sivir-ui/svelte/components/spinner';
	import { toolPresentation } from '$lib/review-transcript';
	import Disclosure from './ui/disclosure.svelte';

	let { tool, duration, active }: { tool: ReviewToolCall; duration: string; active: boolean } = $props();
	const interrupted = $derived(tool.status === 'running' && !active);
	const presentation = $derived(toolPresentation(tool));
	const action = $derived(presentation.action);
	const isRun = $derived(action === 'run' || action === '$');
	const live = $derived(tool.status === 'running' && active);
	// "Reading file" while it runs, "Read file" once it's done.
	const actionLabel = $derived(isRun ? (live ? 'Running' : 'Run')
		: action === 'writeFile' ? (live ? 'Writing file' : 'Write file')
		: action === 'readDiff' ? (live ? 'Reading diff' : 'Read diff')
		: ['readFile', 'read'].includes(action) ? (live ? 'Reading file' : 'Read file')
		: ['search', 'rg'].includes(action) ? (live ? 'Searching' : 'Search')
		: ['listFiles', 'list'].includes(action) ? (live ? 'Listing files' : 'List files')
		: live ? 'Running tool' : 'Run tool');
	const target = $derived(presentation.target || 'Details unavailable');
</script>

<Disclosure size="row" title={target} meta={duration}>
	{#snippet label()}
		<span class="tool-row-action" class:shimmer-text={live}>{actionLabel}</span>
		<span class="tool-row-target" data-command={isRun || undefined}>{target}</span>
		{#if isRun && tool.status !== 'running' && tool.exitCode !== null}<span class="tool-row-exit" data-failed={tool.exitCode !== 0 || undefined}>exit {tool.exitCode}</span>{/if}
		{#if live}<Spinner size={12} class="shrink-0 text-sev-medium" aria-hidden="true" />{/if}
		{#if tool.status === 'error' || interrupted}<span class="shrink-0 text-danger">{interrupted ? 'Interrupted' : 'Failed'}</span>{/if}
	{/snippet}
	<div class="min-w-0 space-y-3 py-1">
		<ScrollArea style="max-height: min(24rem, 50dvh)" aria-label="Tool details" showCues={false}>
			{#if tool.result?.content}
				<CodeBlock code={tool.result.content} lang={action === 'readDiff' ? 'diff' : 'plaintext'} copy="overlay" class="rounded-lg ![--code-block-max-height:none]" />
			{:else}
				<Typography.Text class="break-words text-sm text-foreground-muted">
					{tool.result?.error || tool.summary || (interrupted ? 'The review ended before this operation finished.' : tool.status === 'running' ? (isRun ? 'Running…' : 'Retrieving evidence…') : 'No output was recorded.')}
				</Typography.Text>
			{/if}
			{#if tool.result?.truncated}
				<Typography.Text class="mt-2 text-xs text-foreground-muted">Showing a truncated evidence preview.</Typography.Text>
			{/if}
			{#if tool.result?.evidenceId}
				<Typography.Text class="mt-2 font-mono text-xs text-foreground-muted">{tool.result.evidenceId}{tool.result.revision ? ` · ${tool.result.revision}` : ''}</Typography.Text>
			{/if}
		</ScrollArea>
		{#if tool.input}
			<Disclosure size="sm">
				{#snippet label()}Input{/snippet}
				<Typography.Text class="whitespace-pre-wrap break-all font-mono text-xs text-foreground-muted">{JSON.stringify(tool.input, null, 2)}</Typography.Text>
			</Disclosure>
		{/if}
	</div>
</Disclosure>
