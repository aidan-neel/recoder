<script lang="ts">
	import type { ReviewToolCall } from '@recoder/shared';
	import Check from '@lucide/svelte/icons/check';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import CircleAlert from '@lucide/svelte/icons/circle-alert';
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

<Tool.Root name={label} state={running ? 'running' : failed ? 'error' : 'complete'} variant="quiet" open={false} class="review-tool-group min-w-0">
	{#snippet trigger({ open })}
		{#if running}<Spinner size={14} class="tool-group-icon text-sev-medium" aria-hidden="true" />
		{:else if failed}<CircleAlert size={14} class="tool-group-icon text-danger" aria-hidden="true" />
		{:else}<Check size={14} class="tool-group-icon text-success" aria-hidden="true" />{/if}
		<span class="min-w-0">{label}</span>
		{#if failed}<span class="shrink-0">· {failed} failed</span>{/if}
		<ChevronRight size={14} aria-hidden="true" class="shrink-0 {open ? 'rotate-90' : ''}" />
	{/snippet}
	<div class="tool-rows">
		{#each tools as tool (tool.id)}
			<ReviewToolCallView {tool} duration={duration(tool)} {active} />
		{/each}
	</div>
</Tool.Root>
