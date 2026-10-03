<script lang="ts">
	import type { ReviewReasoningEntry } from '@recoder/shared';
	import ReviewTaskGroup from './review-task-group.svelte';
	import ReasoningTrace from './reasoning-trace.svelte';
	import Disclosure from '../ui/disclosure.svelte';
	import ThoughtLabel from '../ui/thought-label.svelte';
	import { elapsed, type Trace, type TraceHead } from '$lib/review/conversation-rows';
	import { taskGroupLabel, taskGroupStatus } from '$lib/review/review-transcript';
	import { summarizesReasoning } from '$lib/settings/model-settings.svelte';

	/** A transcript row of thoughts and tool runs; a run of several folds under its latest trace. */
	let {
		traces,
		active,
		streaming,
		now,
		clock
	}: {
		traces: Trace[];
		active: boolean;
		/** This conversation's agent or a reply is still going, so a thought with nothing after it is still thinking, even between retries. */
		streaming: boolean;
		now: number;
		/** Ticks while anything is live, for thought timers. */
		clock: number;
	} = $props();

	function thoughtLive(until?: string): boolean {
		return !until && streaming;
	}

	/** A finished thought runs to when it stopped, else to what came next; with neither, it shows no time. */
	function thoughtTime(entry: ReviewReasoningEntry, until?: string): string | undefined {
		const end = entry.endedAt ?? until;

		return end ? elapsed(clock, entry.at, end) : undefined;
	}

	function traceHead(item: Trace): TraceHead {
		if (item.kind === 'tasks') {
			const { status, failed } = taskGroupStatus(item.tools, active);

			return {
				label: `${taskGroupLabel(item.tools, status === 'running')}${failed ? ` · ${failed} failed` : ''}`,
				status
			};
		}

		const working = thoughtLive(item.until);

		return {
			label: '',
			thought: { working, time: working ? elapsed(clock, item.entry.at) : thoughtTime(item.entry, item.until) }
		};
	}

	/** Models that hide their reasoning leave nothing to open. */
	const hasBody = (item: Trace) =>
		item.kind === 'tasks' ||
		(!item.entry.summary && !summarizesReasoning(item.entry.model) && !!item.entry.text.trim());
</script>

{#snippet headLabel(head: TraceHead)}
	{#if head.thought}<ThoughtLabel
			working={head.thought.working}
			time={head.thought.time}
		/>{:else if head.status === 'running'}<span class="shimmer-text">{head.label}</span>{:else}{head.label}{/if}
{/snippet}

{#snippet traceRow(item: Trace)}
	{#if item.kind === 'tasks'}
		<ReviewTaskGroup tools={item.tools} {active} {now} />
	{:else}
		{@const head = traceHead(item)}
		{@const entry = item.entry}
		{@const live = thoughtLive(item.until)}
		<Disclosure bodyClass="thought-body !gap-3" children={hasBody(item) ? thoughtText : undefined}>
			{#snippet label()}{@render headLabel(head)}{/snippet}
		</Disclosure>
		{#snippet thoughtText()}<ReasoningTrace text={entry.text} streaming={live} />{/snippet}
	{/if}
{/snippet}

{#if traces.length === 1}
	{@render traceRow(traces[0])}
{:else}
	{@const head = traceHead(traces[traces.length - 1])}
	<Disclosure status={head.status} bodyClass="!gap-3" children={traces.some(hasBody) ? foldedTraces : undefined}>
		{#snippet label()}{@render headLabel(head)}{/snippet}
	</Disclosure>
	{#snippet foldedTraces()}
		{#each traces as item (item.key)}{@render traceRow(item)}{/each}
	{/snippet}
{/if}
