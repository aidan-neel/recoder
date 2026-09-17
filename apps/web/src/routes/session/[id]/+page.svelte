<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { untrack } from 'svelte';
	import Files from '@lucide/svelte/icons/files';
	import { Button } from '@sivir-ui/svelte/components/button';
	import * as Alert from '@sivir-ui/svelte/components/alert';
	import * as Card from '@sivir-ui/svelte/components/card';
	import { ScrollArea } from '@sivir-ui/svelte/components/scroll-area';
	import { Skeleton } from '@sivir-ui/svelte/components/skeleton';
	import { Spinner } from '@sivir-ui/svelte/components/spinner';
	import * as Sheet from '@sivir-ui/svelte/components/sheet';
	import LiveReviewProgress from '$lib/components/live-review-progress.svelte';
	import ReviewProgress from '$lib/components/review-progress.svelte';
	import ReviewMetricsModal from '$lib/components/review-metrics-modal.svelte';
	import SessionSidebar from '$lib/components/session-sidebar.svelte';
	import FindingsBar from '$lib/components/findings-bar.svelte';
	import CodeDiff from '$lib/components/code-diff.svelte';
	import ThreadPanel from '$lib/components/thread-panel.svelte';
	import { getFileDiff } from '$lib/diff';
	import { findingsStore, mapBackendFinding } from '$lib/findings.svelte';
	import { notesStore } from '$lib/notes.svelte';
	import { threadsStore } from '$lib/threads.svelte';
	import { sessionState } from '$lib/session-state.svelte';
	import { DEFAULT_FILE, sessionFile } from '$lib/session-file.svelte';
	import { serverApi } from '$lib/server-api';
	import { ReviewStream } from '$lib/review-stream.svelte';
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
	/** True when the API itself is unreachable (vs. "no such review" → demo). */
	let backendDown = $state(false);
	/** Bumped by the retry button to re-run the backend check. */
	let retryNonce = $state(0);
	let filesOpen = $state(false);
	let reviewStream = $state<ReviewStream | null>(null);

	function acceptReview(review: Review): void {
		if (page.params.id !== review.id) return;
		// A polling request started before the terminal SSE must not rewind the UI.
		if (backendReview?.id === review.id &&
			(backendReview.status === 'passed' || backendReview.status === 'failed') &&
			(review.status === 'queued' || review.status === 'running')) return;
		backendReview = review;
		const running = review.status === 'queued' || review.status === 'running';
		if (!sessionState.sessions.some((s) => s.id === review.id)) {
			sessionState.ensureSession(review.id, review.prTitle || `PR #${review.prNumber}`, `#${review.prNumber}`, running ? 'reviewing' : 'ready');
		}
		if (!running && sessionState.sessions.find((s) => s.id === review.id)?.status === 'reviewing') {
			sessionState.markReady(review.id);
		}
	}

	const liveReviewId = $derived(backendReview?.id ?? null);
	$effect(() => {
		const currentId = liveReviewId;
		if (!currentId) { reviewStream = null; return; }
		const stream = new ReviewStream(currentId, acceptReview);
		reviewStream = stream;
		return () => stream.close();
	});

	async function refreshBackend(currentId: string): Promise<boolean> {
		try {
			const review = await serverApi.getReview(currentId);
			if (page.params.id !== currentId) return false;
			backendDown = false;
			acceptReview(review);
			try {
				const files = await serverApi.getReviewFiles(currentId);
				if (page.params.id !== currentId) return false;
				backendFiles = files;
			} catch {
				// 404 until the fetch step stores a diff — keep polling.
			}
			backendError = null;
			return review.status === 'queued' || review.status === 'running';
		} catch (e) {
			if (page.params.id !== currentId) return false;
			// Unknown id → mock fallback (demo sessions). Anything else means
			// the API itself is unreachable — surfaced, not silently mocked.
			backendError = e instanceof Error ? e.message : null;
			backendDown = !(e instanceof Error && /review not found/i.test(e.message));
			return backendDown;
		} finally {
			if (page.params.id === currentId) backendChecked = true;
		}
	}

	$effect(() => {
		const currentId = id;
		void retryNonce;
		backendReview = null;
		backendFiles = null;
		backendChecked = false;
		backendError = null;
		backendDown = false;
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

	let peekDiff = $state(false);

	const isBackend = $derived(backendChecked && backendReview !== null);

	// Findings belong to the current session only: backend reviews get exactly
	// their own findings (synced once, so local dismiss/accept is preserved),
	// mock sessions get the local demo set back. Never accumulate across reviews.
	let findingsSyncedFor: string | null = $state(null);
	$effect(() => {
		if (!backendChecked) return;
		if (isBackend && backendReview) {
			threadsStore.reviewId = backendReview.id;
			notesStore.reviewId = backendReview.id;
			const mapped = backendReview.findings.map((f, i) => mapBackendFinding(f, i));
			const terminal =
				backendReview.status === 'passed' || backendReview.status === 'failed';
			if (terminal) {
				if (findingsSyncedFor !== backendReview.id) {
					findingsStore.replaceAll(mapped);
					findingsSyncedFor = backendReview.id;
				}
			} else {
				findingsStore.syncRemote(mapped);
				findingsSyncedFor = `live:${backendReview.id}`;
			}
		} else {
			threadsStore.reviewId = null;
			if (findingsSyncedFor !== 'local') {
				findingsStore.reset();
				findingsSyncedFor = 'local';
			}
		}
	});
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
	const displayFindings = $derived(findingsStore.forFile(sessionFile.currentId));

	// Smart initial file: the strongest open finding's file wins over the
	// alphabetic-first file, and any explicit user pick sticks. Resets per session.
	const SEV_RANK = { high: 0, medium: 1, low: 2, info: 3 } as const;
	let lastAutoFile: string | null = $state(null);
	let userPickedFile = $state(false);
	let resetSessionId: string | null = null;

	$effect(() => {
		const currentId = id;
		if (resetSessionId === currentId) return;
		resetSessionId = currentId;
		untrack(() => {
			lastAutoFile = null;
			userPickedFile = false;
			findingsSyncedFor = null;
			peekDiff = false;
			threadsStore.close();
			threadsStore.pendingMessage = null;
			notesStore.clear();
			// Drop the previous session's file + findings immediately so the new
			// session never flashes stale content while its review loads.
			sessionFile.select(DEFAULT_FILE);
			findingsStore.replaceAll([]);
		});
	});

	// Selections that didn't come from the auto-picker are the user's choice.
	$effect(() => {
		const cur = sessionFile.currentId;
		if (lastAutoFile !== null && cur !== lastAutoFile) userPickedFile = true;
	});

	$effect(() => {
		if (!isBackend || !backendReview || !backendFiles || backendFiles.length === 0) return;
		if (userPickedFile) return;
		const open = findingsStore.items.filter(
			(f) => f.status !== 'dismissed' && findingsStore.isShown(f)
		);
		open.sort(
			(a, b) => SEV_RANK[a.severity] - SEV_RANK[b.severity] || a.startLine - b.startLine
		);
		let target = open[0]?.file ?? backendFiles[0].path;
		if (!backendFiles.some((f) => f.path === target)) target = backendFiles[0].path;
		if (target !== sessionFile.currentId) {
			lastAutoFile = target;
			sessionFile.select(target);
		} else if (lastAutoFile === null) {
			lastAutoFile = target;
		}
	});

	// Live pipeline log while the backend is working (fetch/sandbox/agents).
	let queueing = $state(false);
	/** Queue a fresh backend review for the same repo/PR and jump to it. */
	async function rerunReview(): Promise<void> {
		if (!backendReview || queueing) return;
		queueing = true;
		backendError = null;
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
	<div class="mx-auto flex min-h-[calc(100dvh-4rem)] w-full max-w-md flex-col justify-center px-4">
		<h1 class="text-lg font-semibold tracking-tight">Session not found</h1>
		<Button href="/" class="mt-4 w-fit font-sans">Start a review</Button>
	</div>
{:else if !backendChecked}
	<div class="mx-auto flex min-h-[calc(100dvh-4rem)] w-full max-w-md flex-col justify-center gap-3 px-4" role="status" aria-label="Loading session">
		<Skeleton class="h-7 w-2/3 rounded-lg" />
		<Skeleton class="h-4 w-full rounded-md" />
		<Skeleton class="h-4 w-5/6 rounded-md" />
	</div>
{:else if !isBackend && session.status === 'reviewing'}
	<ReviewProgress
		title={`${session.ref ?? session.name} · ${session.name}`}
		repo={session.name}
		prLabel={session.ref}
		onDone={() => sessionState.markReady(session.id)}
	/>
{:else if backendReview && reviewStream && !peekDiff}
	{@const diffFiles = backendFiles ?? []}
	{#key backendReview.id}
	<LiveReviewProgress
		review={backendReview}
		stream={reviewStream}
		repo={session.name}
		files={backendFiles ? diffFiles.length : null}
		additions={backendFiles ? diffFiles.reduce((sum, f) => sum + f.additions, 0) : null}
		deletions={backendFiles ? diffFiles.reduce((sum, f) => sum + f.deletions, 0) : null}
		onOpenDiff={backendFiles?.length ? () => (peekDiff = true) : null}
		onRestart={() => void rerunReview()}
		restarting={queueing}
		actionError={backendError}
	/>
	{/key}
{:else}
	<div class="flex h-full flex-col">
	{#if backendError}
		<Alert.Root variant="error" class="mx-3 mt-3 shrink-0">
			<Alert.Title>Review data unavailable</Alert.Title>
			<Alert.Description>
				{backendDown
					? `Review API unreachable (${backendError}) — showing local demo content.`
					: backendError}
			</Alert.Description>
			<Button
				variant="outline"
				class="mt-2 w-fit font-sans"
				onclick={() => (retryNonce += 1)}
			>
				Retry
			</Button>
		</Alert.Root>
	{/if}
	<div class="flex min-h-0 flex-1">
		<div class="shrink-0 max-lg:hidden {threadsStore.openId ? 'max-xl:hidden' : ''}">
			<SessionSidebar fileDiffs={isBackend ? (backendFiles ?? []) : null} />
		</div>
		<div class="m-3 flex min-w-0 flex-1 flex-col gap-3">
			<Sheet.Root bind:open={filesOpen}>
				<div class="lg:hidden">
					<Sheet.Trigger variant="outline" class="max-w-full justify-start">
						<Files size={15} aria-hidden="true" />
						<span class="truncate font-mono text-[13px]">{sessionFile.currentId}</span>
					</Sheet.Trigger>
				</div>
				<Sheet.Content side="left" class="[&>[data-ui=sheet-surface]]:p-0">
					<Sheet.Title class="sr-only">Changed files</Sheet.Title>
					<SessionSidebar
						fileDiffs={isBackend ? (backendFiles ?? []) : null}
						onFileSelect={() => (filesOpen = false)}
					/>
				</Sheet.Content>
			</Sheet.Root>
			{#if isBackend && backendReview}
				<div class="flex shrink-0 flex-col gap-2">
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
						{#if backendReview.prTitle}{backendReview.prTitle}{:else}PR #{backendReview.prNumber}{/if}
					</span>
					{#if peekDiff}
						<Button
							variant="ghost"
							size="sm"
							class="ml-auto h-8 shrink-0 font-sans"
							onclick={() => (peekDiff = false)}
						>
							Conversation
						</Button>
					{/if}
					<ReviewMetricsModal reviewId={backendReview.id} />
					</div>
					<FindingsBar />
				</div>
			{:else}
				<FindingsBar />
			{/if}
			<div class="flex min-h-0 flex-1 gap-3">
				<div id="diff-panel" class="relative min-h-0 min-w-0 flex-1 {threadsStore.openId ? 'max-xl:hidden' : ''}">
					{#if isBackend && backendReview?.status === 'failed' && !backendFiles}
						<Alert.Root variant="error" class="absolute inset-0 flex items-center justify-center p-6 text-center">
							<Alert.Title>Review failed</Alert.Title>
							<Alert.Description class="max-w-md">
								{backendReview.summary ?? 'The pipeline failed before producing a diff.'}
							</Alert.Description>
							<Alert.Description class="font-mono text-[12px]">
								Fix the cause, then press Review above to retry.
							</Alert.Description>
						</Alert.Root>
					{:else if isBackend && !backendFiles}
						<div class="absolute inset-0" role="status" aria-label="Fetching PR diff">
						<Card.Root class="h-full overflow-hidden p-4">
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
						</Card.Root>
						</div>
					{:else}
						<ScrollArea
							orientation="vertical"
							aria-label="Code diff"
							class="absolute inset-0 rounded-xl border border-border"
							showCues={false}
						>
							{#key fileDiff.path}
								<div class="min-h-full">
									<CodeDiff diff={fileDiff} findings={displayFindings} />
								</div>
							{/key}
						</ScrollArea>
					{/if}
				</div>
				{#if threadsStore.openId}
					{#key threadsStore.openId}
						<ThreadPanel />
					{/key}
				{/if}
			</div>
		</div>
	</div>
	</div>
{/if}
