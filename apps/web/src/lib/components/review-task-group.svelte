<script lang="ts">
	import type { ReviewToolCall } from '@recoder/shared';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import * as Tool from '@sivir-ui/svelte/components/tool';
	import { Spinner } from '@sivir-ui/svelte/components/spinner';
	import { taskGroupLabel } from '$lib/review-transcript';
	import ReviewToolCallView from './review-tool-call.svelte';

	let { tools, active, now }: { tools: ReviewToolCall[]; active: boolean; now: number } = $props();
	const running = $derived(active && tools.some((tool) => tool.status === 'running'));
	const failed = $derived(tools.filter((tool) => tool.status === 'error' || (!active && tool.status === 'running')).length);
	const label = $derived(taskGroupLabel(tools));
	function duration(tool: ReviewToolCall) {
		const elapsed = tool.status === 'running' && active ? now - Date.parse(tool.startedAt) : tool.elapsedMs;
		return elapsed === undefined ? '' : elapsed < 1000 ? `${Math.max(0, Math.round(elapsed))}ms` : `${(elapsed / 1000).toFixed(1)}s`;
	}
</script>

<Tool.Root name={label} state={running ? 'running' : failed ? 'error' : 'complete'} open={false} class="min-w-0 [&>button]:min-h-10">
	{#snippet trigger({ open })}
		<ChevronDown size={14} aria-hidden="true" class="shrink-0 text-foreground-muted transition-transform motion-reduce:transition-none {open ? '' : '-rotate-90'}" />
		{#if running}<Spinner size={14} aria-hidden="true" />{/if}
		<span class="min-w-0 flex-1 text-sm text-foreground-muted">{label}</span>
		{#if failed}<span class="shrink-0 text-xs text-error">{failed} failed</span>{/if}
	{/snippet}
	{#each tools as tool (tool.id)}
		<ReviewToolCallView {tool} duration={duration(tool)} {active} />
	{/each}
</Tool.Root>
