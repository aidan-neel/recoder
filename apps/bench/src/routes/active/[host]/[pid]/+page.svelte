<script lang="ts">
	import { onMount } from 'svelte';
	import { Button } from '@sivir-ui/svelte/components/button';
	import * as Card from '@sivir-ui/svelte/components/card';
	import { Progress } from '@sivir-ui/svelte/components/progress';
	import { ScrollArea } from '@sivir-ui/svelte/components/scroll-area';
	import StatTile from '$lib/components/charts/stat-tile.svelte';
	import PrPanels from '$lib/components/reports/pr-panels.svelte';
	import { LIVE, poll } from '$lib/live/poll';
	import { minutes, percent, shortDate, shortModel } from '$lib/reports/stats';

	let { data } = $props();

	onMount(() => poll(LIVE, 5_000));

	const run = $derived(data.run);
	const view = $derived(data.view);

	function since(iso: string | null): string {
		return iso ? minutes(data.now - Date.parse(iso)) : '–';
	}
</script>

<ScrollArea class="h-full min-h-0" aria-label="Run" showCues={false}>
	<div class="bench-page">
		{#if !run}
			<div class="bench-head">
				<h1 class="bench-title">Run ended</h1>
			</div>
			<Card.Root class="bench-panel">
				<div class="bench-empty flex flex-col items-center gap-3">
					This run is no longer running. Its report is in the list.
					<Button href="/reports" variant="outline">Reports</Button>
				</div>
			</Card.Root>
		{:else}
			<div class="bench-head">
				<div class="min-w-0">
					<h1 class="bench-title">{run.dataset} · {run.only ? run.only.join(', ') : 'every PR'}</h1>
					<div class="bench-meta">
						<span>{run.hostLabel} <b>pid {run.pid}</b></span>
						<span>started <b>{shortDate(run.startedAt)}</b></span>
						<span>judge <b>{shortModel(run.judge)}</b></span>
						<span>runs <b>{run.runs}</b></span>
						<span>concurrency <b>{run.concurrency}</b></span>
						<span>server <b>{run.base}</b></span>
					</div>
				</div>
				{#if view}<Button href="/reports/{view.entry.key}" variant="outline">Open report</Button>{/if}
			</div>

			<div class="stat-tiles" data-cols="4">
				<StatTile
					label="Reviews done"
					value="{run.done}/{run.expected ?? '?'}"
					detail="{run.reviews.length} running now"
				/>
				<StatTile
					label="Recall so far"
					value={run.planted ? percent(run.found / run.planted) : '–'}
					detail={run.planted ? `${run.found}/${run.planted} defects` : 'no review scored yet'}
				/>
				<StatTile label="Elapsed" value={since(run.startedAt)} detail="since the run started" />
				<StatTile
					label="Per review"
					value={view?.entry.meanReviewMinutes ? minutes(view.entry.meanReviewMinutes * 60_000) : '–'}
					detail="mean of passed runs"
				/>
			</div>

			<section class="bench-section">
				<h2 class="bench-section-title">Running reviews</h2>
				<Card.Root class="bench-panel">
					{#if run.reviews.length}
						<ul class="review-list">
							{#each run.reviews as review (review.id)}
								<li class="review-item">
									<div class="review-item-head">
										<span class="run-row-name">{review.label ?? `PR #${review.prNumber}`}</span>
										<span class="run-row-meta"
											>{since(review.startedAt)} · {review.agents} agents{#if review.model}
												· {shortModel(review.model)}{/if}</span
										>
										<span class="run-row-progress">
											<span>{review.tasksDone}/{review.tasksTotal} tasks</span>
											<Progress
												value={review.tasksDone}
												max={review.tasksTotal || 1}
												indeterminate={!review.tasksTotal}
											/>
										</span>
									</div>
									{#if review.tasks?.length}
										<ul class="task-list">
											{#each review.tasks as task, index (index)}
												<li>
													<span class="task-label">{task.label}</span>
													<span class="task-message">{task.message}</span>
													<span class="task-time">{since(task.startedAt)}</span>
												</li>
											{/each}
										</ul>
									{/if}
								</li>
							{/each}
						</ul>
					{:else}
						<p class="bench-empty">No review is running. The run is starting one or scoring.</p>
					{/if}
				</Card.Root>
			</section>

			{#if view}
				<section class="bench-section">
					<h2 class="bench-section-title">Scored so far</h2>
					<div class="bench-grid">
						<PrPanels {view} />
					</div>
				</section>
			{/if}

			<section class="bench-section">
				<h2 class="bench-section-title">Log, newest first</h2>
				<Card.Root class="bench-panel">
					{#if run.log}
						<ScrollArea class="max-h-[420px]" aria-label="Log" showCues={false}>
							<pre class="log-tail">{data.log || 'The log is empty.'}</pre>
						</ScrollArea>
					{:else}
						<p class="bench-empty">This run writes its output to a terminal, not a file.</p>
					{/if}
				</Card.Root>
			</section>
		{/if}
	</div>
</ScrollArea>
