<script lang="ts">
	import type { ReviewReasoningEntry, ReviewToolCall } from '@recoder/shared';
	import { ScrollArea } from '@sivir-ui/svelte/components/scroll-area';
	import ReasoningTrace from './reasoning-trace.svelte';
	import ReviewToolCallView from './review-tool-call.svelte';
	import Disclosure from '../ui/disclosure.svelte';
	import ThoughtLabel from '../ui/thought-label.svelte';
	import { elapsed, traceSpan, type Trace } from '$lib/review/conversation-rows';
	import { taskGroupLabel, taskGroupStatus } from '$lib/review/review-transcript';
	import { followOutput } from '$lib/shell/follow-output';
	import { summarizesReasoning } from '$lib/settings/model-settings.svelte';

	/**
	 * Everything the agent did between two messages as one quiet line, "Worked for 24s". Its thoughts and
	 * tool runs sit inside, in order, so the conversation reads as messages with the work tucked away.
	 */
	let {
		traces,
		active,
		streaming,
		now,
		clock,
		pending = false,
		note = null
	}: {
		traces: Trace[];
		active: boolean;
		/** This conversation's agent or a reply is still going, so a thought with nothing after it is still thinking, even between retries. */
		streaming: boolean;
		now: number;
		/** Ticks while anything is live, for thought timers. */
		clock: number;
		/** The newest work while the agent is still at it, so it stays live between tool calls. */
		pending?: boolean;
		/** What the agent says it is doing, shown while no tool is running. */
		note?: string | null;
	} = $props();

	function thoughtLive(until?: string): boolean {
		return !until && streaming;
	}

	function isLive(item: Trace): boolean {
		return item.kind === 'tasks' ? taskGroupStatus(item.tools, active).status === 'running' : thoughtLive(item.until);
	}

	function toolDuration(tool: ReviewToolCall): string {
		const ms = tool.status === 'running' && active ? now - Date.parse(tool.startedAt) : tool.elapsedMs;

		if (ms === undefined) return '';

		return ms < 1000 ? `${Math.max(0, Math.round(ms))}ms` : `${(ms / 1000).toFixed(1)}s`;
	}

	/** A finished thought runs to when it stopped, else to what came next; with neither, it shows no time. */
	function thoughtTime(entry: ReviewReasoningEntry, until?: string): string | undefined {
		const end = entry.endedAt ?? until;

		return end ? elapsed(clock, entry.at, end) : undefined;
	}

	/** Models that hide their reasoning leave nothing to open. */
	const hasBody = (item: Trace) =>
		item.kind === 'tasks' ||
		(!item.entry.summary && !summarizesReasoning(item.entry.model) && !!item.entry.text.trim());

	const live = $derived(pending || traces.some(isLive));

	/** The work shows while it happens and tucks itself into one line when it ends. */
	let open = $derived(live);
	let log = $state<HTMLDivElement>();

	$effect(() => {
		if (log && live) return followOutput(log);
	});
	const failed = $derived(
		traces.reduce((n, item) => n + (item.kind === 'tasks' ? taskGroupStatus(item.tools, active).failed : 0), 0)
	);
	const span = $derived(traceSpan(traces));
	const time = $derived(
		live ? elapsed(clock, span.start) : span.end ? elapsed(clock, span.start, span.end) : undefined
	);

	/** What is going on right now, beside the live label: the running tools, else what the agent says. */
	const doing = $derived.by(() => {
		if (!live) return '';

		const running = traces.findLast((item) => item.kind === 'tasks' && isLive(item));

		return running?.kind === 'tasks' ? taskGroupLabel(running.tools, true) : (note ?? '');
	});
</script>

<Disclosure
	bind:open
	status={failed ? 'error' : undefined}
	class="work-log"
	bodyClass="!gap-1"
	children={traces.some(hasBody) ? entries : undefined}
>
	{#snippet label()}
		<ThoughtLabel working={live} {time} doing="Working" done="Worked" />
		{#if failed}<span class="work-log-note">· {failed} failed</span>{/if}
		{#if doing}<span class="work-log-note">· {doing}</span>{/if}
	{/snippet}
</Disclosure>

{#snippet entries()}
	<ScrollArea bind:element={log} orientation="vertical" showCues={false} class="work-log-scroll">
		<div class="work-log-entries">
			{#each traces as item (item.key)}
				{#if item.kind === 'tasks'}
					{#each item.tools as tool (tool.id)}
						<ReviewToolCallView {tool} duration={toolDuration(tool)} {active} />
					{/each}
				{:else if hasBody(item)}
					{@const working = thoughtLive(item.until)}
					<Disclosure size="sm" bodyClass="thought-body !gap-3">
						{#snippet label()}<ThoughtLabel
								{working}
								time={working ? elapsed(clock, item.entry.at) : thoughtTime(item.entry, item.until)}
							/>{/snippet}
						<ReasoningTrace text={item.entry.text} streaming={working} />
					</Disclosure>
				{/if}
			{/each}
		</div>
	</ScrollArea>
{/snippet}
