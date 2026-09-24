<script lang="ts">
	import type { ReviewToolCall } from '@recoder/shared';
	import { taskGroupLabel } from '$lib/review-transcript';
	import Disclosure from './ui/disclosure.svelte';
	import ReviewToolCallView from './review-tool-call.svelte';

	let { tools, active, now }: { tools: ReviewToolCall[]; active: boolean; now: number } = $props();
	const running = $derived(active && tools.some((tool) => tool.status === 'running'));
	const failed = $derived(tools.filter((tool) => tool.status === 'error' || (!active && tool.status === 'running')).length);
	const groupLabel = $derived(taskGroupLabel(tools));
	function duration(tool: ReviewToolCall) {
		const elapsed = tool.status === 'running' && active ? now - Date.parse(tool.startedAt) : tool.elapsedMs;
		return elapsed === undefined ? '' : elapsed < 1000 ? `${Math.max(0, Math.round(elapsed))}ms` : `${(elapsed / 1000).toFixed(1)}s`;
	}
</script>

<Disclosure status={running ? 'running' : failed ? 'error' : 'done'} class="review-tool-group" bodyClass="!gap-0">
	{#snippet label()}{groupLabel}{#if failed}<span class="ms-1">· {failed} failed</span>{/if}{/snippet}
	{#each tools as tool (tool.id)}
		<ReviewToolCallView {tool} duration={duration(tool)} {active} />
	{/each}
</Disclosure>
