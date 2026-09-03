<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { Button } from '@sivir-ui/svelte/components/button';
	import { ScrollArea } from '@sivir-ui/svelte/components/scroll-area';
	import { Skeleton } from '@sivir-ui/svelte/components/skeleton';
	import { Spinner } from '@sivir-ui/svelte/components/spinner';
	import LiveReviewProgress from '$lib/components/live-review-progress.svelte';
	import ReviewProgress from '$lib/components/review-progress.svelte';
	import SessionSidebar from '$lib/components/session-sidebar.svelte';
	import FindingsBar from '$lib/components/findings-bar.svelte';
	import CodeDiff from '$lib/components/code-diff.svelte';
	import ThreadPanel from '$lib/components/thread-panel.svelte';
	import { getFileDiff } from '$lib/diff';
	import { findingsStore } from '$lib/findings.svelte';
	import { sessionState } from '$lib/session-state.svelte';
	import { sessionFile } from '$lib/session-file.svelte';
	import { serverApi } from '$lib/server-api';
	import type { FileDiff, Review } from '@recoder/shared';

	const id = $derived(page.params.id ?? '');
	const session = $derived(sessionState.sessions.find((s) => s.id === id));

	// Keep the top-bar tab highlight in sync with the route (direct loads,
	// back/forward, recent-session jumps).
	$effect(() => {
		if (session && sessionState.activeId !== session.id) {
			sessionState.select(session.id);
		}
	});

	// Live backend review (if this id is a real review id). Falls back to
	// the mock session when the API is down or the id is unknown.
	let backendReview = $state<Review | null>(null);
	let backendFiles = $state<FileDiff[] | null>(null);
	let backendChecked = $state(false);
	let backendError = $state<string | null>(null);

	async function refreshBackend(currentId: string): Promise<boolean> {
		try {
			const review = await serverApi.getReview(currentId);
			if (page.params.id !== currentId) return false;
			backendReview = review;
			try {
				const files = await serverApi.getReviewFiles(currentId);
				if (page.params.id !== currentId) return false;
				backendFiles = files;
				if (
					files.length > 0 &&
					!files.some((f) => f.path === sessionFile.currentId)
				) {
					sessionFile.select(files[0].path);
				}
			} catch {
				// 404 until the fetch step stores a diff — keep polling.
			}
			backendError = null;
			return review.status === 'queued' || review.status === 'running';
		} catch (e) {
			if (page.params.id !== currentId) return false;
			// Unknown id or API down → mock fallback (demo sessions).
			backendReview = null;
			backendFiles = null;
			backendError = e instanceof Error ? e.message : null;
			return false;
		} finally {
			if (page.params.id === currentId) backendChecked = true;
		}
	}

	$effect(() => {
		const currentId = id;
		backendReview = null;
		backendFiles = null;
		backendChecked = false;
		backendError = null;
		let stopped = false;
		let timer: ReturnType<typeof setInterval> | undefined;

		void (async () => {
			const keepPolling = await refreshBackend(currentId);
			if (stopped || !keepPolling) return;
			timer = setInterval(async () => {
				const more = await refreshBackend(currentId);
				if (!more && timer) clearInterval(timer);
			}, 2500);
		})();

		return () => {
			stopped = true;
			if (timer) clearInterval(timer);
		};
	});

	const isBackend = $derived(backendChecked && backendReview !== null);
	const liveDiff = $derived.by(() => {
		if (!backendFiles) return null;
		return (
			backendFiles.find((f) => f.path === sessionFile.currentId) ??
			backendFiles[0] ??
			null
		);
	});
	const fileDiff = $derived.by((): FileDiff => {
		if (!isBackend) return getFileDiff(sessionFile.currentId);
		if (liveDiff) return liveDiff;
		return { path: sessionFile.currentId, additions: 0, deletions: 0, hunks: [] };
	});
	const displayFindings = $derived(
		isBackend ? [] : findingsStore.forFile(sessionFile.currentId)
	);
	const backendRunning = $derived(
		isBackend &&
			backendReview !== null &&
			(backendReview.status === 'queued' || backendReview.status === 'running')
	);

	// Live pipeline log while the backend is working (fetch/sandbox/agents).
	let queueing = $state(false);
	/** Queue a fresh backend review for the same repo/PR and jump to it. */
	async function rerunReview(): Promise<void> {
		if (!backendReview || queueing) return;
		queueing = true;
		try {
			const review = await serverApi.queueReview({
				repoId: backendReview.repoId,
				prNumber: backendReview.prNumber
			});
			sessionState.ensureSession(
				review.id,
				session?.name ?? 'session',
				`#${review.prNumber}`,
				'reviewing'
			);
			await goto(`/session/${review.id}`);
		} catch (e) {
			backendError = e instanceof Error ? e.message : 'Failed to queue review.';
		} finally {
			queueing = false;
		}
	}
</script>

{#if !session}
	<div class="mx-auto flex min-h-[calc(100vh-52px-4rem)] w-full max-w-md flex-col justify-center px-4">
		<h1 class="text-lg font-semibold tracking-tight">Session not found</h1>
		<p class="mt-1 text-[14px] text-foreground-muted">
			This session doesn't exist. Start a fresh review instead.
		</p>
		<Button href="/" class="mt-4 w-fit font-sans">Start a review</Button>
	</div>
{:else if !backendChecked}
	<div class="mx-auto flex min-h-[calc(100vh-52px-4rem)] w-full max-w-md flex-col justify-center gap-3 px-4" role="status" aria-label="Loading session">
		<Skeleton class="h-7 w-2/3 rounded-lg" />
		<Skeleton class="h-4 w-full rounded-md" />
		<Skeleton class="h-4 w-5/6 rounded-md" />
	</div>
{:else if !isBackend && session.status === 'reviewing'}
	<ReviewProgress
		title={`${session.ref ?? session.name} · ${session.name}`}
		repo={session.name}
		onDone={() => sessionState.markReady(session.id)}
	/>
{:else if backendRunning && backendReview}
	<LiveReviewProgress review={backendReview} fileCount={backendFiles?.length ?? 0} />
{:else}
	<div class="flex h-[calc(100vh-52px)]">
		<SessionSidebar
			fileDiffs={isBackend ? (backendFiles ?? []) : null}
			repoName={session.name}
			prLabel={isBackend && backendReview ? `PR #${backendReview.prNumber}` : (session.ref ? `PR ${session.ref}` : 'Local')}
		/>
		<div class="m-3 flex min-w-0 flex-1 flex-col gap-3">
			{#if isBackend && backendReview}
				<div
					class="flex shrink-0 items-center gap-2 font-mono text-[13px] text-foreground-muted"
					role="status"
				>
					{#if backendReview.status === 'queued' || backendReview.status === 'running'}
						<Spinner size={13} aria-hidden="true" />
					{:else}
						<span
							class="h-1.5 w-1.5 shrink-0 rounded-full"
							style:background-color={backendReview.status === 'passed' ? '#3fb96c' : '#e0655f'}
						></span>
					{/if}
					<span class="truncate">
						{#if backendReview.prTitle}{backendReview.prTitle} · {/if}PR #{backendReview.prNumber}
						· {backendReview.source} · {backendReview.status}{backendFiles
							? ` · ${backendFiles.length} files`
							: ' · fetching diff…'}
					</span>
					{#if backendReview.status === 'passed' || backendReview.status === 'failed'}
						<Button
							variant="primary"
							size="sm"
							class="ml-auto h-8 shrink-0 font-sans"
							loading={queueing}
							onclick={() => void rerunReview()}
						>
							Review
						</Button>
					{/if}
				</div>
			{:else}
				<FindingsBar />
			{/if}
			<div id="diff-panel" class="session-enter relative min-h-0 flex-1" style="animation-delay: 120ms">
				{#if isBackend && backendReview?.status === 'failed' && !backendFiles}
					<div
						class="absolute inset-0 flex flex-col items-center justify-center gap-2 rounded-xl border border-border p-6 text-center"
						role="alert"
					>
						<p class="text-[15px] font-medium">Review failed</p>
						<p class="max-w-md text-[13px] leading-relaxed text-foreground-muted">
							{backendReview.summary ?? 'The pipeline failed before producing a diff.'}
						</p>
						<p class="font-mono text-[12px] text-foreground-muted">
							Fix the cause, then press Review above to retry.
						</p>
					</div>
				{:else if isBackend && !backendFiles}
					<div
						class="absolute inset-0 overflow-hidden rounded-xl border border-border p-4"
						role="status"
						aria-label="Fetching PR diff"
					>
						<div class="flex items-center gap-2 text-[14px] text-foreground-muted">
							<Spinner size={15} aria-hidden="true" />
							Fetching PR diff…
						</div>
						<div class="mt-4 flex flex-col gap-2.5">
							<Skeleton class="h-4 w-11/12 rounded-md" />
							<Skeleton class="h-4 w-full rounded-md" />
							<Skeleton class="h-4 w-4/5 rounded-md" />
							<Skeleton class="h-4 w-full rounded-md" />
							<Skeleton class="h-4 w-3/5 rounded-md" />
							<Skeleton class="h-4 w-5/6 rounded-md" />
						</div>
					</div>
				{:else}
					<ScrollArea
						orientation="vertical"
						aria-label="Code diff"
						class="absolute inset-0 rounded-xl border border-border"
					>
						{#key fileDiff.path}
							<div class="diff-enter min-h-full">
								<CodeDiff diff={fileDiff} findings={displayFindings} />
							</div>
						{/key}
					</ScrollArea>
				{/if}
				<ThreadPanel />
			</div>
		</div>
	</div>
{/if}
