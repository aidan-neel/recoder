<script lang="ts">
	import type { ReviewToolCall } from '@recoder/shared';
	import { taskGroupLabel, taskGroupStatus } from '$lib/review-transcript';
	import Disclosure from './ui/disclosure.svelte';
	import ReviewToolCallView from './review-tool-call.svelte';

	let { tools, active, now }: { tools: ReviewToolCall[]; active: boolean; now: number } = $props();
	const group = $derived(taskGroupStatus(tools, active));
	const failed = $derived(group.failed);
	const groupLabel = $derived(taskGroupLabel(tools, group.status === 'running'));
	function duration(tool: ReviewToolCall) {
		const elapsed = tool.status === 'running' && active ? now - Date.parse(tool.startedAt) : tool.elapsedMs;
		return elapsed === undefined ? '' : elapsed < 1000 ? `${Math.max(0, Math.round(elapsed))}ms` : `${(elapsed / 1000).toFixed(1)}s`;
	}
</script>

<Disclosure status={group.status} class="review-tool-group" bodyClass="!gap-0">
	{#snippet label()}<span class={group.status === 'running' ? 'shimmer-text' : undefined}>{groupLabel}</span>{#if failed}<span class="ms-1">· {failed} failed</span>{/if}{/snippet}
	{#each tools as tool (tool.id)}
		<ReviewToolCallView {tool} duration={duration(tool)} {active} />
	{/each}
</Disclosure>
