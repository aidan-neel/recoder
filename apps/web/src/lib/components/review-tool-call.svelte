<script lang="ts">
	import type { ReviewToolCall } from '@recoder/shared';
	import * as Tool from '@sivir-ui/svelte/components/tool';
	import { CodeBlock } from '@sivir-ui/svelte/components/code-block';
	import { ScrollArea } from '@sivir-ui/svelte/components/scroll-area';
	import * as Typography from '@sivir-ui/svelte/components/typography';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import { Spinner } from '@sivir-ui/svelte/components/spinner';

	let { tool, duration, active, quiet = false }: { tool: ReviewToolCall; duration: string; active: boolean; quiet?: boolean } = $props();
	const interrupted = $derived(tool.status === 'running' && !active);
	const action = $derived(tool.input?.action ?? tool.command.split(' ')[0]);
	const actionLabel = $derived(action === 'readDiff' ? 'Read diff' : ['readFile', 'read'].includes(action) ? 'Read file' : ['search', 'rg'].includes(action) ? 'Search' : ['listFiles', 'list'].includes(action) ? 'List files' : 'Run tool');
	const target = $derived(tool.input?.path ?? tool.input?.query ?? tool.input?.prefix ?? tool.command.replace(/^\S+\s*/, ''));
</script>

<Tool.Root
	name={tool.command}
	state={tool.status === 'done' ? 'complete' : interrupted ? 'error' : tool.status}
	variant={quiet ? 'quiet' : 'default'}
	{duration}
	open={false}
	class="min-w-0 [&>button]:min-h-9"
>
	{#snippet trigger({ open })}
		<ChevronDown size={12} aria-hidden="true" class="shrink-0 text-foreground-muted transition-transform motion-reduce:transition-none {open ? '' : '-rotate-90'}" />
		{#if tool.status === 'running' && active}<Spinner size={12} aria-hidden="true" />{/if}
		<span class="shrink-0 text-xs text-foreground-muted">{actionLabel}</span>
		<span class="min-w-0 flex-1 truncate font-mono text-xs" title={target}>{target}</span>
		{#if tool.status === 'error' || interrupted}<span class="shrink-0 text-xs text-error">{interrupted ? 'Interrupted' : 'Failed'}</span>{/if}
	{/snippet}
	<ScrollArea style="max-height: min(24rem, 50dvh)" aria-label="Tool details" showCues={false}>
		{#if tool.input}
			<Tool.Input>
				<Typography.Text class="whitespace-pre-wrap break-all font-mono text-xs">{JSON.stringify(tool.input, null, 2)}</Typography.Text>
			</Tool.Input>
		{/if}
		<Tool.Output label={interrupted ? 'Interrupted' : tool.summary || 'Result'}>
			{#if tool.result?.content}
				<CodeBlock code={tool.result.content} lang={tool.input?.action === 'readDiff' ? 'diff' : 'plaintext'} copy="overlay" class="![--code-block-max-height:none]" />
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
		</Tool.Output>
	</ScrollArea>
</Tool.Root>
