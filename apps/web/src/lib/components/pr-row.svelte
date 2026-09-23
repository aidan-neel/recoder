<script lang="ts">
	import Check from '@lucide/svelte/icons/check';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import GitPullRequest from '@lucide/svelte/icons/git-pull-request';
	import Link2 from '@lucide/svelte/icons/link-2';
	import LoaderCircle from '@lucide/svelte/icons/loader';
	import MessageSquare from '@lucide/svelte/icons/message-square';
	import Play from '@lucide/svelte/icons/play';
	import { Badge } from '@sivir-ui/svelte/components/badge';
	import { Button } from '@sivir-ui/svelte/components/button';
	import * as ContextMenu from '@sivir-ui/svelte/components/context-menu';
	import { Progress } from '@sivir-ui/svelte/components/progress';
	import { Spinner } from '@sivir-ui/svelte/components/spinner';
	import type { PullRequest, Review } from '@recoder/shared';
	import { isRunning, prStatus, shortAge } from '$lib/home';

	interface Props {
		pr: PullRequest;
		review?: Review;
		progress?: { tasksDone: number; tasksTotal: number };
		/** Review request in flight from this row. */
		starting?: boolean;
		/** Finished while Home was open: check icon, count fades in. */
		justFinished?: boolean;
		highlighted?: boolean;
		disabled?: boolean;
		onOpen: () => void;
		onReview: () => void;
		onInteractive: () => void;
	}

	let {
		pr,
		review,
		progress,
		starting = false,
		justFinished = false,
		highlighted = false,
		disabled = false,
		onOpen,
		onReview,
		onInteractive
	}: Props = $props();

	const running = $derived(!starting && isRunning(review));
	const state = $derived(starting ? 'starting' : running ? 'running' : justFinished ? 'done' : 'idle');
	const status = $derived(prStatus(review));
	const title = $derived(pr.title === '' ? `PR #${pr.number}` : pr.title);
	const hasSession = $derived(!!review);

	function copyLink(): void {
		void navigator.clipboard?.writeText(pr.url).catch(() => {});
	}
</script>

<ContextMenu.Root>
	<ContextMenu.Trigger class="pr-row" data-state={state} data-highlighted={highlighted || undefined} data-pr={String(pr.number)}>
		<span class="pr-row-icon" aria-hidden="true">
			{#if state === 'starting' || state === 'running'}
				<LoaderCircle size={16} strokeWidth={1.75} class="spin" />
			{:else if state === 'done'}
				<Check size={16} strokeWidth={1.75} />
			{:else}
				<GitPullRequest size={16} strokeWidth={1.75} />
			{/if}
		</span>
		<span class="flex min-w-0 flex-1 flex-col gap-[5px]">
			<span class="flex min-w-0 items-baseline gap-2">
				<Button
					unstyled
					class="pr-row-open min-w-0 truncate text-left text-[14.5px] text-fg"
					aria-label={hasSession ? `Open the review of ${title}, #${pr.number}` : `Review ${title}, #${pr.number}`}
					{disabled}
					onclick={onOpen}
				>
					{title}
				</Button>
				<span class="shrink-0 font-mono text-[12px] text-fg-faint">#{pr.number}</span>
			</span>
			{#if running}
				<span class="flex h-[15px] items-center gap-2.5 text-[12px] text-fg-faint">
					<span class="shimmer-text">
						{progress?.tasksTotal ? `Working · ${progress.tasksDone}/${progress.tasksTotal}` : 'Planning'}
					</span>
					<Progress indeterminate class="pr-row-bar" {...{ 'aria-label': 'Review running' }} />
				</span>
			{:else}
				<span class="pr-row-meta">
					<span class="truncate text-fg-subtle" title={pr.headRef}>{pr.headRef}</span>
					<span aria-hidden="true">→</span>
					<span class="shrink-0">{pr.base}</span>
					<span aria-hidden="true">·</span>
					<span class="shrink-0">{pr.changedFiles} file{pr.changedFiles === 1 ? '' : 's'}</span>
					<span class="shrink-0 text-ok">+{pr.additions}</span>
					<span class="shrink-0 text-danger">−{pr.deletions}</span>
					{#if pr.createdAt}
						<span aria-hidden="true">·</span>
						<span class="shrink-0">{shortAge(pr.createdAt)}</span>
					{/if}
				</span>
			{/if}
		</span>

		<span class="pr-row-side">
			<span class="pr-row-rest">
				{#if status}
					{#key status.label}
						<Badge variant="secondary" class="status-chip {justFinished ? 'enter-rise' : ''}" data-tone={status.tone}>
							{status.label}
						</Badge>
					{/key}
				{/if}
				<ChevronRight size={16} strokeWidth={1.75} class="text-fg-ghost" aria-hidden="true" />
			</span>
			{#if !running}
				<span class="pr-row-actions">
					<Button variant="outline" class="pr-row-btn" {disabled} onclick={onInteractive}>
						<MessageSquare size={14} strokeWidth={1.75} aria-hidden="true" />
						Interactive
					</Button>
					<Button class="pr-row-btn pr-row-review" {disabled} aria-busy={starting} onclick={onReview}>
						{#if starting}
							<Spinner size={12} aria-hidden="true" />
							Starting
						{:else}
							<Play size={12} fill="currentColor" aria-hidden="true" />
							Review
						{/if}
					</Button>
				</span>
			{/if}
		</span>
	</ContextMenu.Trigger>
	<ContextMenu.Content class="min-w-[13rem]">
		{#if hasSession}
			<ContextMenu.Item callback={onOpen}>
				<span class="flex items-center gap-2"><ChevronRight size={14} aria-hidden="true" /> Open last review</span>
			</ContextMenu.Item>
		{/if}
		<ContextMenu.Item callback={onReview}>
			<span class="flex items-center gap-2"><Play size={14} aria-hidden="true" /> Start a new review</span>
		</ContextMenu.Item>
		<ContextMenu.Item callback={onInteractive}>
			<span class="flex items-center gap-2"><MessageSquare size={14} aria-hidden="true" /> Interactive review</span>
		</ContextMenu.Item>
		<ContextMenu.Item callback={copyLink}>
			<span class="flex items-center gap-2"><Link2 size={14} aria-hidden="true" /> Copy link</span>
		</ContextMenu.Item>
	</ContextMenu.Content>
</ContextMenu.Root>
