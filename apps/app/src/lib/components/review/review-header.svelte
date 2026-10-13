<script lang="ts">
	import ArrowUpRight from '@lucide/svelte/icons/arrow-up-right';
	import Bot from '@lucide/svelte/icons/bot';
	import GitBranch from '@lucide/svelte/icons/git-branch';
	import { Button } from '@sivir-ui/svelte/components/button';
	import * as Tooltip from '@sivir-ui/svelte/components/tooltip';
	import ProgressRing from '../ui/progress-ring.svelte';
	import type { ReviewState } from '$lib/review/review-state.svelte';
	import { author } from '$lib/shell/format';

	interface Props {
		view: ReviewState;
	}

	let { view }: Props = $props();

	const review = $derived(view.review!);
	const who = $derived(view.pull ? author(view.pull.author) : null);
	const total = $derived(view.surface?.decisions.length ?? 0);
	const url = $derived(review.prUrl ?? view.pull?.url ?? null);
</script>

<header class="review-head">
	<div class="review-head-main">
		<h1 class="review-title truncate">{review.prTitle ?? view.pull?.title ?? `Pull request #${review.prNumber}`}</h1>
		<div class="review-meta">
			<span class="mono">#{review.prNumber}</span>
			{#if who}
				<span class="review-sep" aria-hidden="true">·</span>
				<span class="review-author" class:agent={who.agent}
					>{#if who.agent}<Bot size={12} aria-label="Agent" />{/if}{who.name}</span
				>
			{/if}
			{#if view.pull}
				<span class="review-sep" aria-hidden="true">·</span>
				<span class="review-branch mono"
					><GitBranch size={12} aria-hidden="true" />{view.pull.headRef}<span class="review-arrow">→</span>{view.pull
						.base}</span
				>
				<span class="review-sep" aria-hidden="true">·</span>
				<span class="mono tabular"
					><span class="text-ok">+{view.pull.additions}</span>
					<span class="text-sev-high">−{view.pull.deletions}</span></span
				>
			{/if}
		</div>
	</div>
	<div class="review-head-side">
		{#if view.running}
			<span class="review-running shimmer-text"
				>Reviewing{view.progress ? ` · ${view.progress.tasksDone} of ${view.progress.tasksTotal}` : ''}</span
			>
		{:else if total > 0}
			<span class="review-tally">
				<ProgressRing value={view.decided} max={total} />
				<span class="tabular">{view.decided} of {total} decided</span>
			</span>
		{/if}
		{#if url}
			<Tooltip.Root placement="bottom">
				<Tooltip.Trigger>
					<Button variant="ghost" size="icon" href={url} target="_blank" rel="noreferrer" aria-label="Open on GitHub">
						<ArrowUpRight size={16} />
					</Button>
				</Tooltip.Trigger>
				<Tooltip.Content>Open on GitHub</Tooltip.Content>
			</Tooltip.Root>
		{/if}
	</div>
</header>
