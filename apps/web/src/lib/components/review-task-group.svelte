<script lang="ts">
	import type { ReviewToolCall } from '@recoder/shared';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
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

<Tool.Root name={label} state={running ? 'running' : failed ? 'error' : 'complete'} variant="quiet" open={false} class="review-tool-disclosure min-w-0">
	{#snippet trigger({ open })}
		<span class="min-w-0 text-sm">{label}</span>
		{#if running}<Spinner size={12} aria-hidden="true" />{/if}
		{#if failed}<span class="shrink-0 text-xs">· {failed} failed</span>{/if}
		<ChevronRight size={14} aria-hidden="true" class="shrink-0 {open ? 'rotate-90' : ''}" />
	{/snippet}
	<div class="my-1 flex min-w-0 flex-col gap-1 border-s border-border ps-3">
		{#each tools as tool (tool.id)}
			<ReviewToolCallView {tool} duration={duration(tool)} {active} />
		{/each}
	</div>
</Tool.Root>
