<script lang="ts">
	import type { Snippet } from 'svelte';
	import Ellipsis from '@lucide/svelte/icons/ellipsis';
	import GitBranch from '@lucide/svelte/icons/git-branch';
	import { Button } from '@sivir-ui/svelte/components/button';
	import * as DropdownMenu from '@sivir-ui/svelte/components/dropdown-menu';
	import * as Tabs from '@sivir-ui/svelte/components/tabs';
	import * as Typography from '@sivir-ui/svelte/components/typography';

	export type SessionView = 'conversation' | 'findings' | 'diff';

	interface Props {
		title: string;
		branch?: string | null;
		repo?: string | null;
		prLabel?: string | null;
		/** Off when the step row below carries the divider. */
		bordered?: boolean;
		files?: number | null;
		additions?: number | null;
		deletions?: number | null;
		view: SessionView;
		onView?: ((view: SessionView) => void | Promise<void>) | null;
		/** The diff exists only once the review has checked out the PR. */
		diffDisabled?: boolean;
		onFiles?: (() => void) | null;
		filesLabel?: string;
		menu?: Snippet;
	}

	let {
		title, branch = null, repo = null, prLabel = null, bordered = true, files = null, additions = null, deletions = null,
		view, onView = null, diffDisabled = false, onFiles = null, filesLabel = 'Open diff', menu
	}: Props = $props();

	/**
	 * Sivir Tabs keeps its own value after a click. The conversation header stays
	 * mounted while hidden, so snap back to the real view once navigation settles.
	 */
	let current = $state<string>('conversation');
	$effect.pre(() => {
		current = view;
	});
	let mounted = true;
	$effect(() => () => (mounted = false));
	function choose(next: string): void {
		if (next === view) return;
		// A view switch can unmount this header; only a surviving one snaps back.
		void Promise.resolve(onView?.(next as SessionView)).finally(() => {
			if (mounted) current = view;
		});
	}
</script>

<header class="session-header" data-bordered={bordered || undefined}>
	<Typography.Title level={1} class="session-title" {title}>{title}</Typography.Title>
	<div class="session-meta">
		{#if branch}
			<span class="session-branch" title={branch}><GitBranch size={12} aria-hidden="true" /><span class="truncate">{branch}</span></span>
		{/if}
		{#if repo}<span class="shrink-0">{repo}{prLabel ? ` ${prLabel}` : ''}</span>{/if}
		{#if files !== null}
			<Button variant="quiet" class="session-files" disabled={!onFiles} onclick={onFiles ?? undefined} aria-label="{filesLabel}, {files} changed {files === 1 ? 'file' : 'files'}">
				<span>{files} {files === 1 ? 'file' : 'files'}</span>
				{#if additions !== null}<span class="text-success">+{additions}</span>{/if}
				{#if deletions !== null}<span class="text-danger">−{deletions}</span>{/if}
			</Button>
		{/if}
	</div>
	{#if onView}
		<Tabs.Root bind:value={current} onValueChange={choose} variant="segmented" class="view-switch">
			<Tabs.List {...{ 'aria-label': 'Session view' }}>
				<Tabs.Trigger value="conversation">Conversation</Tabs.Trigger>
				<Tabs.Trigger value="findings" disabled={diffDisabled}>Findings</Tabs.Trigger>
				<Tabs.Trigger value="diff" disabled={diffDisabled}>Diff</Tabs.Trigger>
			</Tabs.List>
		</Tabs.Root>
	{/if}
	{#if menu}
		<DropdownMenu.Root>
			<DropdownMenu.Trigger variant="ghost" size="icon" aria-label="Session actions"><Ellipsis size={16} aria-hidden="true" /></DropdownMenu.Trigger>
			<DropdownMenu.Content>{@render menu()}</DropdownMenu.Content>
		</DropdownMenu.Root>
	{/if}
</header>
