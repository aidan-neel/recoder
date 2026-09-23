<script lang="ts">
	import type { Snippet } from 'svelte';
	import Ellipsis from '@lucide/svelte/icons/ellipsis';
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
		/** Diff workspace: its toolbar (findings stepper, filters, actions) takes the meta's place, so the view has one bar. */
		toolbar?: Snippet;
	}

	let {
		title, branch = null, repo = null, prLabel = null, bordered = true, files = null, additions = null, deletions = null,
		view, onView = null, diffDisabled = false, onFiles = null, filesLabel = 'Open diff', menu, toolbar
	}: Props = $props();

	/** Branch, repo and diffstat, shown in the title's tooltip. */
	const tooltip = $derived([title, [repo, prLabel].filter(Boolean).join(' '), branch, files !== null ? `${files} ${files === 1 ? 'file' : 'files'} +${additions ?? 0} −${deletions ?? 0}` : null].filter(Boolean).join(' · '));

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

<!-- Same bar in every view: title far left · view tabs centred · ⋯ and the
     view's actions (toolbar) far right. Branch/repo/diffstat live in the title's tooltip. -->
<header class="session-header" data-bordered={bordered || undefined} data-merged="">
	<Typography.Title level={1} class="session-title" title={tooltip}>{title}</Typography.Title>
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
	{#if toolbar}
		<div class="session-toolbar">{@render toolbar()}</div>
	{/if}
</header>
