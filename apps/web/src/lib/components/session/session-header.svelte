<script lang="ts">
	import type { Snippet } from 'svelte';
	import Ellipsis from '@lucide/svelte/icons/ellipsis';
	import * as DropdownMenu from '@sivir-ui/svelte/components/dropdown-menu';
	import * as HoverCard from '@sivir-ui/svelte/components/hover-card';
	import * as Tabs from '@sivir-ui/svelte/components/tabs';
	import * as Typography from '@sivir-ui/svelte/components/typography';
	import { carryPill, keepPillAligned } from '$lib/shell/tab-pill';

	export type SessionView = 'conversation' | 'findings' | 'diff';

	/**
	 * One bar for every view: PR number and view tabs on the left; the view's toolbar, its status and the menu on the right.
	 * The title, repo, branch and diffstat live in the PR hover card.
	 */
	interface Props {
		title: string;
		branch?: string | null;
		repo?: string | null;
		prLabel?: string | null;
		/** The pull request on its host; the PR number links there. */
		prUrl?: string | null;
		/** Off when the step row below carries the divider. */
		bordered?: boolean;
		files?: number | null;
		additions?: number | null;
		deletions?: number | null;
		view: SessionView;
		onView?: ((view: SessionView) => void | Promise<void>) | null;
		/** The diff exists only once the review has checked out the PR. */
		diffDisabled?: boolean;
		menu?: Snippet;
		/** Diff workspace: its toolbar (findings stepper, filters, actions) takes the meta's place, so the view has one bar. */
		toolbar?: Snippet;
		/** Usage and checks: at the far right, just before the menu. */
		status?: Snippet;
	}

	let {
		title,
		branch = null,
		repo = null,
		prLabel = null,
		prUrl = null,
		bordered = true,
		files = null,
		additions = null,
		deletions = null,
		view,
		onView = null,
		diffDisabled = false,
		menu,
		toolbar,
		status
	}: Props = $props();

	/** The PR number opens the pull request on its host in a new tab (the trigger forwards these to its link). */
	const prLinkAttrs = $derived<Record<string, string>>(prUrl ? { target: '_blank', rel: 'noreferrer' } : {});

	/** "ai/ark #209": the repo, unless the caller only knows the PR title. */
	const source = $derived([repo && repo !== title ? repo : null, prLabel].filter(Boolean).join(' '));

	/**
	 * Sivir Tabs keeps its own value after a click. The conversation header stays
	 * mounted while hidden, so snap back to the real view once navigation settles.
	 */
	let current = $derived<string>(view);
	let mounted = true;
	$effect(() => () => (mounted = false));
	/** Switches view. The switch can unmount this header, so only a surviving one snaps back. */
	function choose(next: string): void {
		if (next === view) return;

		void Promise.resolve(onView?.(next as SessionView)).finally(() => {
			if (mounted) current = view;
		});
	}
</script>

<header class="session-header" data-bordered={bordered || undefined} data-merged="">
	<HoverCard.Root>
		<HoverCard.Trigger class="session-pr" href={prUrl ?? undefined} {...prLinkAttrs}
			>{prLabel || repo || 'Review'}</HoverCard.Trigger
		>
		<HoverCard.Content side="bottom" align="start" class="session-pr-card">
			<HoverCard.Title class="session-pr-title">{title}</HoverCard.Title>
			{#if source}<Typography.Metadata class="session-pr-meta">{source}</Typography.Metadata>{/if}
			{#if branch || files !== null}
				<Typography.Metadata class="session-pr-meta">
					{#if branch}<span class="truncate">{branch}</span>{/if}
					{#if branch && files !== null}<span aria-hidden="true">·</span>{/if}
					{#if files !== null}<span class="shrink-0"
							>{files}
							{files === 1 ? 'file' : 'files'} <span class="text-success">+{additions ?? 0}</span>
							<span class="text-danger">−{deletions ?? 0}</span></span
						>{/if}
				</Typography.Metadata>
			{/if}
		</HoverCard.Content>
	</HoverCard.Root>
	{#if onView}
		<Tabs.Root bind:value={current} onValueChange={choose} variant="segmented" class="view-switch">
			<Tabs.List
				{...{ 'aria-label': 'Session view' }}
				{@attach keepPillAligned}
				{@attach (list: HTMLElement) => carryPill(list, 'session-view', view)}
			>
				<Tabs.Trigger value="conversation">Review</Tabs.Trigger>
				<Tabs.Trigger value="findings" disabled={diffDisabled}>Findings</Tabs.Trigger>
				<Tabs.Trigger value="diff" disabled={diffDisabled}>Diff</Tabs.Trigger>
			</Tabs.List>
		</Tabs.Root>
	{/if}
	<div class="session-actions">
		{#if toolbar}
			<div class="session-toolbar">{@render toolbar()}</div>
		{/if}
		{@render status?.()}
		{#if menu}
			<DropdownMenu.Root>
				<DropdownMenu.Trigger variant="ghost" size="icon" aria-label="Session actions"
					><Ellipsis size={16} aria-hidden="true" /></DropdownMenu.Trigger
				>
				<DropdownMenu.Content>{@render menu()}</DropdownMenu.Content>
			</DropdownMenu.Root>
		{/if}
	</div>
</header>
