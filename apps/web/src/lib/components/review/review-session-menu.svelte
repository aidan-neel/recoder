<script lang="ts">
	import * as DropdownMenu from '@sivir-ui/svelte/components/dropdown-menu';
	import { closeSessionTab } from '$lib/session/session-tabs';
	import { requestDeleteSession } from '$lib/session/delete-session.svelte';
	import { guidelinesStore } from '$lib/settings/guidelines.svelte';

	/** The session header's menu items for a review: diff, usage, guidelines, run control and the tab. */
	let {
		reviewId,
		repoId,
		active,
		awaitingPrompt,
		paused,
		restarting,
		onOpenDiff,
		onRestart,
		onMetrics,
		onTogglePause,
		onCancel
	}: {
		reviewId?: string;
		repoId: string | null;
		active: boolean;
		awaitingPrompt: boolean;
		paused: boolean;
		restarting: boolean;
		onOpenDiff: (() => void) | null;
		/** Asks to restart; the caller confirms first. */
		onRestart: (() => void) | null;
		onMetrics: () => void;
		onTogglePause: () => void;
		onCancel: () => void;
	} = $props();
</script>

{#if onOpenDiff && !active}<DropdownMenu.Item callback={onOpenDiff}>Open diff</DropdownMenu.Item>{/if}
{#if reviewId}<DropdownMenu.Item callback={onMetrics}>View token usage</DropdownMenu.Item>{/if}
{#if repoId}{@const id = repoId}<DropdownMenu.Item callback={() => guidelinesStore.open({ kind: 'repo', repoId: id })}
		>Review guidelines</DropdownMenu.Item
	>{/if}
{#if reviewId && active && !awaitingPrompt}
	<DropdownMenu.Item callback={onTogglePause}>{paused ? 'Resume review' : 'Pause review'}</DropdownMenu.Item>
	<DropdownMenu.Item callback={onCancel}>Cancel review</DropdownMenu.Item>
{/if}
{#if onRestart}<DropdownMenu.Item disabled={restarting} callback={onRestart}
		>{restarting ? 'Restarting…' : 'Restart review'}</DropdownMenu.Item
	>{/if}
{#if reviewId}{@const id = reviewId}<DropdownMenu.Separator /><DropdownMenu.Item
		callback={() => void closeSessionTab(id)}>Close tab</DropdownMenu.Item
	><DropdownMenu.Item class="menu-danger" callback={() => requestDeleteSession(id)}>Delete session</DropdownMenu.Item
	>{/if}
