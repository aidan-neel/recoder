<script lang="ts">
	import type { ReviewToolCall } from '@recoder/shared';
	import * as Tool from '@sivir-ui/svelte/components/tool';
	import { CodeBlock } from '@sivir-ui/svelte/components/code-block';
	import { ScrollArea } from '@sivir-ui/svelte/components/scroll-area';
	import * as Typography from '@sivir-ui/svelte/components/typography';

	let { tool, duration, active }: { tool: ReviewToolCall; duration: string; active: boolean } = $props();
	const interrupted = $derived(tool.status === 'running' && !active);
</script>

<Tool.Root
	name={tool.command}
	state={tool.status === 'done' ? 'complete' : interrupted ? 'error' : tool.status}
	{duration}
	open={false}
	class="min-w-0 [&>button]:min-h-9"
>
	<ScrollArea style="max-height: min(24rem, 50dvh)" aria-label="Tool details" showCues={false}>
		{#if tool.input}
			<Tool.Input>
				<Typography.Text class="whitespace-pre-wrap break-all font-mono text-xs">{JSON.stringify(tool.input, null, 2)}</Typography.Text>
			</Tool.Input>
		{/if}
		<Tool.Output label={interrupted ? 'Interrupted' : tool.summary || 'Result'}>
			{#if tool.result?.content}
				<CodeBlock code={tool.result.content} lang={tool.input?.action === 'readDiff' ? 'diff' : 'plaintext'} copy="overlay" />
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
