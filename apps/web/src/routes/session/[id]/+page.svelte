<script lang="ts">
	import { page } from '$app/state';
	import { Button } from '@sivir-ui/svelte/components/button';
	import { ScrollArea } from '@sivir-ui/svelte/components/scroll-area';
	import ReviewProgress from '$lib/components/review-progress.svelte';
	import SessionSidebar from '$lib/components/session-sidebar.svelte';
	import FindingsBar from '$lib/components/findings-bar.svelte';
	import CodeDiff from '$lib/components/code-diff.svelte';
	import ThreadPanel from '$lib/components/thread-panel.svelte';
	import { getFileDiff } from '$lib/diff';
	import { findingsStore } from '$lib/findings.svelte';
	import { sessionState } from '$lib/session-state.svelte';
	import { sessionFile } from '$lib/session-file.svelte';

	const fileDiff = $derived(getFileDiff(sessionFile.currentId));

	const id = $derived(page.params.id);
	const session = $derived(sessionState.sessions.find((s) => s.id === id));
</script>

{#if !session}
	<div class="mx-auto flex min-h-[calc(100vh-52px-4rem)] w-full max-w-md flex-col justify-center px-4">
		<h1 class="text-lg font-semibold tracking-tight">Session not found</h1>
		<p class="mt-1 text-[14px] text-foreground-muted">
			This session doesn't exist. Start a fresh review instead.
		</p>
		<Button href="/" class="mt-4 w-fit font-sans">Start a review</Button>
	</div>
{:else if session.status === 'reviewing'}
	<ReviewProgress
		title={`${session.ref ?? session.name} · ${session.name}`}
		repo={session.name}
		onDone={() => sessionState.markReady(session.id)}
	/>
{:else}
	<div class="flex h-[calc(100vh-52px)]">
		<SessionSidebar />
		<div class="m-3 flex min-w-0 flex-1 flex-col gap-3">
			<FindingsBar />
			<div id="diff-panel" class="relative min-h-0 flex-1">
				<ScrollArea
					orientation="both"
					aria-label="Code diff"
					class="absolute inset-0 rounded-xl border border-border"
				>
					<CodeDiff
						diff={fileDiff}
						findings={findingsStore.forFile(sessionFile.currentId)}
					/>
				</ScrollArea>
				<ThreadPanel />
			</div>
		</div>
	</div>
{/if}
