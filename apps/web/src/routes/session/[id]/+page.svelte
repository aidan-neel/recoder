<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { tick, untrack } from 'svelte';
	import MessageSquare from '@lucide/svelte/icons/message-square';
	import X from '@lucide/svelte/icons/x';
	import Check from '@lucide/svelte/icons/check';
	import { Button } from '@sivir-ui/svelte/components/button';
	import * as Alert from '@sivir-ui/svelte/components/alert';
	import * as Card from '@sivir-ui/svelte/components/card';
	import * as DropdownMenu from '@sivir-ui/svelte/components/dropdown-menu';
	import { ScrollArea } from '@sivir-ui/svelte/components/scroll-area';
	import Skeleton from '$lib/components/ui/skeleton.svelte';
	import { Spinner } from '@sivir-ui/svelte/components/spinner';
	import * as Sheet from '@sivir-ui/svelte/components/sheet';
	import * as Typography from '@sivir-ui/svelte/components/typography';
	import SessionSkeleton from '$lib/components/session-skeleton.svelte';
	import LiveReviewProgress from '$lib/components/live-review-progress.svelte';
	import ReviewProgress from '$lib/components/review-progress.svelte';
	import ReviewMetricsModal from '$lib/components/review-metrics-modal.svelte';
	import SessionSidebar from '$lib/components/session-sidebar.svelte';
	import SessionHeader, { type SessionView } from '$lib/components/session-header.svelte';
	import DiffFileHeader from '$lib/components/diff-file-header.svelte';
	import FindingsFocus from '$lib/components/findings-focus.svelte';
	import { diffPrefs } from '$lib/diff-prefs.svelte';
	import FindingsBar from '$lib/components/findings-bar.svelte';
	import CodeDiff from '$lib/components/code-diff.svelte';
	import ThreadPanel from '$lib/components/thread-panel.svelte';
	import ReviewConversation from '$lib/components/review-conversation.svelte';
	import { getFileDiff } from '$lib/diff';
	import { findingsStore, mapBackendFinding } from '$lib/findings.svelte';
	import { notesStore } from '$lib/notes.svelte';
	import { threadsStore } from '$lib/threads.svelte';
	import { sessionState } from '$lib/session-state.svelte';
	import { DEFAULT_FILE, sessionFile } from '$lib/session-file.svelte';
	import { serverApi } from '$lib/server-api';
	import { ReviewStream } from '$lib/review-stream.svelte';
	import { recentSessions } from '$lib/recent-sessions.svelte';
	import { closeSessionTab } from '$lib/session-tabs';
	import { paletteContext } from '$lib/palette.svelte';
	import { ORCHESTRATOR_ID, type FileDiff, type Review, type ReviewCodeContext, type ReviewAssignment } from '@recoder/shared';

	const id = $derived(page.params.id ?? '');
	const session = $derived(sessionState.sessions.find((s) => s.id === id));

	// Keep the top-bar tab highlight in sync with the route (direct loads,
	// back/forward, recent-session jumps).
	$effect(() => {
		if (session && sessionState.activeId !== session.id) {
			sessionState.select(session.id);
		}
	});

	// Review metadata and repository files load independently of the live chat.
	let backendReview = $state<Review | null>(null);
	let backendFiles = $state<FileDiff[] | null>(null);
	let backendChecked = $state(false);
	let backendError = $state<string | null>(null);
	let filesError = $state<string | null>(null);
	let filesRetryNonce = $state(0);
	/** True when the API itself is unreachable (vs. "no such review" → demo). */
	let backendDown = $state(false);
	/** Bumped by the retry button to re-run the backend check. */
	let retryNonce = $state(0);
	let filesOpen = $state(false);
	let usageOpen = $state(false);
	let reviewStream = $state<ReviewStream | null>(null);

	function acceptReview(review: Review): void {
		if (page.params.id !== review.id) return;
		// A polling request started before the terminal SSE must not rewind the UI.
		if (backendReview?.id === review.id &&
			(backendReview.status === 'passed' || backendReview.status === 'failed') &&
			(review.status === 'queued' || review.status === 'running')) return;
		if (backendReview?.id === review.id && backendReview.status !== 'draft' && review.status === 'draft') return;
		backendReview = review;
		// Keep the session list's status in sync with terminal and live stream events.
		const recentIndex = recentSessions.reviews.findIndex((item) => item.id === review.id);
		if (recentIndex >= 0) recentSessions.reviews[recentIndex] = review;
		const running = review.status === 'queued' || review.status === 'running';
		if (!sessionState.sessions.some((s) => s.id === review.id)) {
			sessionState.ensureSession(review.id, review.prTitle || `PR #${review.prNumber}`, `#${review.prNumber}`, running ? 'reviewing' : 'ready');
		}
		if (!running && sessionState.sessions.find((s) => s.id === review.id)?.status === 'reviewing') {
			sessionState.markReady(review.id);
		}
	}

	const liveReviewId = $derived(backendReview?.id ?? null);
	const liveReviewStatus = $derived(backendReview?.status);
	$effect(() => {
		const currentId = liveReviewId;
		if (!currentId) { reviewStream = null; return; }
		const stream = new ReviewStream(currentId, acceptReview);
		reviewStream = stream;
		return () => stream.close();
	});

	async function refreshBackend(currentId: string, signal: AbortSignal): Promise<boolean> {
		try {
			const review = await serverApi.getReview(currentId, AbortSignal.any([signal, AbortSignal.timeout(15_000)]));
			if (signal.aborted || page.params.id !== currentId) return false;
			backendDown = false;
			acceptReview(review);
			backendError = null;
			return review.status === 'draft' || review.status === 'queued' || review.status === 'running';
		} catch (e) {
			if (signal.aborted || page.params.id !== currentId) return false;
			// Unknown id → mock fallback (demo sessions). Anything else means
			// the API itself is unreachable — surfaced, not silently mocked.
			backendError = e instanceof Error && e.name === 'TimeoutError' ? 'Loading the session timed out. Try again.' : e instanceof Error ? e.message : 'Could not load the session.';
			backendDown = !(e instanceof Error && /review not found/i.test(e.message));
			return backendDown;
		} finally {
			if (!signal.aborted && page.params.id === currentId) backendChecked = true;
		}
	}

	$effect(() => {
		const currentId = id;
		void retryNonce;
		backendReview = null;
		backendFiles = null;
		filesError = null;
		backendChecked = false;
		backendError = null;
		backendDown = false;
		const controller = new AbortController();
		let timer: ReturnType<typeof setTimeout> | undefined;
		async function poll() {
			const more = await refreshBackend(currentId, controller.signal);
			if (!controller.signal.aborted && more) timer = setTimeout(poll, 2500);
		}
		void poll();

		return () => {
			controller.abort();
			if (timer) clearTimeout(timer);
		};
	});

	// Chat/SSE can render as soon as metadata arrives. Expanding repository files
	// can take much longer, and must never block the conversation or overlap polls.
	$effect(() => {
		const currentId = liveReviewId;
		const status = liveReviewStatus;
		void filesRetryNonce;
		if (!currentId || !status || status === 'draft') return;
		const controller = new AbortController();
		let timer: ReturnType<typeof setTimeout> | undefined;
		async function loadFiles() {
			try {
				const files = await serverApi.getReviewFiles(currentId!, AbortSignal.any([controller.signal, AbortSignal.timeout(30_000)]));
				if (controller.signal.aborted || page.params.id !== currentId) return;
				backendFiles = files;
				filesError = null;
			} catch {
				if (controller.signal.aborted || page.params.id !== currentId) return;
				// A diff is not available during checkout or after an early failure.
				if (status === 'passed' || status === 'failed') filesError = 'Could not load the code diff. Try again.';
			} finally {
				if (!controller.signal.aborted && (status === 'queued' || status === 'running')) timer = setTimeout(loadFiles, 2500);
			}
		}
		void loadFiles();
		return () => {
			controller.abort();
			if (timer) clearTimeout(timer);
		};
	});

	/** Conversation, Findings (focus mode) or Diff (inline mode), kept in the URL. */
	const workspaceView = $derived.by((): 'findings' | 'diff' | null => {
		const view = page.url.searchParams.get('view');
		return view === 'findings' || view === 'diff' ? view : null;
	});
	const peekDiff = $derived(workspaceView !== null);
	function setView(view: SessionView): Promise<void> {
		const url = new URL(page.url);
		if (view === 'conversation') url.searchParams.delete('view');
		else url.searchParams.set('view', view);
		return goto(`${url.pathname}${url.search}`, { noScroll: true, keepFocus: true });
	}
	function setDiffView(open: boolean): void {
		void setView(open ? 'diff' : 'conversation');
	}
	$effect(() => diffPrefs.useReview(backendReview?.id ?? null));
	let chatOpen = $state(false);
	let chatDraft = $state('');
	let codeContext = $state<ReviewCodeContext | null>(null);
	let chatFocus = $state(0);
	let chatReturnFocus: HTMLElement | null = null;
	const showChat = $derived(chatOpen && !threadsStore.openId);
	const sidePanelOpen = $derived(!!threadsStore.openId || showChat);
	const reviewing = $derived(backendReview?.status === 'running' || backendReview?.status === 'queued');
	const orchestrator = $derived<ReviewAssignment>({
		id: ORCHESTRATOR_ID, role: 'orchestrator', title: 'Orchestrator', reason: '', scope: [],
		status: reviewing ? 'running' : backendReview?.status === 'draft' ? 'waiting' : backendReview?.status === 'failed' ? 'error' : 'done'
	});
	function openChat(context?: ReviewCodeContext): void {
		chatReturnFocus = context ? document.getElementById('ask-review') : document.activeElement instanceof HTMLElement ? document.activeElement : null;
		threadsStore.close();
		if (context) { codeContext = context; userPickedFile = true; }
		chatOpen = true;
		chatFocus++;
	}
	async function closeChat(): Promise<void> {
		chatOpen = false;
		await tick();
		if (chatReturnFocus?.isConnected) chatReturnFocus.focus();
		else document.getElementById('ask-review')?.focus();
	}

	const isBackend = $derived(backendChecked && backendReview !== null);

	// ⌘K palette: this session's scope, files, and the Orchestrator.
	$effect(() => {
		const review = backendReview;
		if (!review) return;
		const repo = recentSessions.repos.find((item) => item.id === review.repoId)?.name ?? review.repoId.slice(0, 8);
		paletteContext.session = { id: review.id, repo: repo.split('/').pop() ?? repo, pr: review.prNumber };
		paletteContext.ask = async (text) => {
			setDiffView(false);
			await serverApi.sendReviewMessage(review.id, ORCHESTRATOR_ID, text);
		};
		paletteContext.showView = (view) => setDiffView(view === 'diff');
		return () => {
			paletteContext.session = null;
			paletteContext.ask = null;
			paletteContext.showView = null;
		};
	});
	$effect(() => {
		paletteContext.files = backendFiles ?? [];
		return () => {
			paletteContext.files = [];
		};
	});

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
			chatOpen = false;
			chatDraft = '';
			codeContext = null;
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
				prNumber: backendReview.prNumber,
				prTitle: backendReview.prTitle ?? undefined,
				start: false
			});
			sessionState.ensureSession(
				review.id,
				session?.name ?? 'session',
				`#${review.prNumber}`,
				'ready'
			);
			await goto(`/session/${review.id}`);
		} catch (e) {
			backendError = e instanceof Error ? e.message : 'Failed to queue review.';
		} finally {
			queueing = false;
		}
	}
</script>

<svelte:window onkeydown={(event) => {
	if (event.key === 'Escape' && !event.defaultPrevented && document.activeElement?.closest('#interactive-review')) {
		event.preventDefault();
		void closeChat();
	}
}} />

{#if !backendChecked}
	<SessionSkeleton specialist={!!page.url.searchParams.get('agent')} />
{:else if backendDown && !backendReview}
	<div class="mx-auto flex h-full w-full max-w-[776px] flex-col justify-center px-4 sm:px-6">
		<Alert.Root variant="error">
			<Alert.Title>Could not load session</Alert.Title>
			<Alert.Description>{backendError}</Alert.Description>
			<Button variant="outline" class="mt-3 w-fit" onclick={() => retryNonce++}>Retry</Button>
		</Alert.Root>
	</div>
{:else if !session}
	<div class="mx-auto flex min-h-[calc(100dvh-4rem)] w-full max-w-md flex-col justify-center px-4">
		<Typography.Title level={1} class="text-lg font-semibold tracking-tight">Session not found</Typography.Title>
		<Button href="/" class="mt-4 w-fit font-sans">Start a review</Button>
	</div>
{:else if !isBackend && session.status === 'reviewing'}
	<ReviewProgress
		title={`${session.ref ?? session.name} · ${session.name}`}
		repo={session.name}
		prLabel={session.ref}
		onDone={() => sessionState.markReady(session.id)}
	/>
{:else if backendReview && reviewStream}
	{@const diffFiles = backendFiles ?? []}
	<div class="flex h-full flex-col" class:hidden={peekDiff}>
	{#if filesError}
		<Alert.Root variant="error" class="mx-4 mt-2 shrink-0">
			<Alert.Title>{filesError}</Alert.Title>
			<Button variant="outline" class="mt-2 w-fit" onclick={() => filesRetryNonce++}>Retry loading diff</Button>
		</Alert.Root>
	{/if}
	<div class="min-h-0 flex-1">
	{#key backendReview.id}
	<LiveReviewProgress
		review={backendReview}
		stream={reviewStream}
		repo={session.name}
		files={backendFiles ? diffFiles.length : null}
		additions={backendFiles ? diffFiles.reduce((sum, f) => sum + f.additions, 0) : null}
		deletions={backendFiles ? diffFiles.reduce((sum, f) => sum + f.deletions, 0) : null}
		onOpenDiff={backendReview.status !== 'draft' ? () => setDiffView(true) : null}
		onShowView={backendReview.status !== 'draft' ? (view) => setView(view) : null}
		onOpenFinding={(finding) => { if (finding.file) { sessionFile.select(finding.file); userPickedFile = true; } setDiffView(true); }}
		onRestart={() => void rerunReview()}
		restarting={queueing}
		actionError={backendError}
	/>
	{/key}
	</div>
	</div>
	{#if peekDiff}{@render diffWorkspace()}{/if}
{:else}
	{@render diffWorkspace()}
{/if}

{#snippet diffMenu()}
	{#if backendReview}<DropdownMenu.Item callback={() => setDiffView(false)}>Show conversation</DropdownMenu.Item>{/if}
	{#if backendReview}<DropdownMenu.Item callback={() => usageOpen = true}>View token usage</DropdownMenu.Item>{/if}
	<DropdownMenu.Separator />
	<DropdownMenu.Item callback={() => void closeSessionTab(id)}>Close tab</DropdownMenu.Item>
{/snippet}

{#snippet diffWorkspace()}
	{@const files = backendFiles ?? (isBackend ? [] : [fileDiff])}
	{@const recent = recentSessions.recent.find((item) => item.id === id)}
	<div class="review-workspace flex h-full min-h-0 flex-col">
	<SessionHeader
		title={backendReview?.prTitle || session?.name || 'Review'}
		branch={recent?.branch}
		repo={session?.name}
		prLabel={backendReview ? `#${backendReview.prNumber}` : session?.ref}
		files={files.length}
		additions={files.reduce((sum, file) => sum + file.additions, 0)}
		deletions={files.reduce((sum, file) => sum + file.deletions, 0)}
		view={workspaceView ?? 'diff'}
		onView={backendReview ? setView : null}
		onFiles={() => (filesOpen = true)}
		filesLabel="Browse changed files"
		menu={diffMenu}
	/>
	<Sheet.Root bind:open={filesOpen}>
		<Sheet.Content side="left" class="w-[400px] max-w-[calc(100%-1rem)] [&>[data-ui=sheet-surface]]:bg-background [&>[data-ui=sheet-surface]]:p-0">
			<Sheet.Title class="sr-only">Changed files</Sheet.Title>
			<SessionSidebar inSheet fileDiffs={isBackend ? (backendFiles ?? []) : null} onFileSelect={() => filesOpen = false} />
		</Sheet.Content>
	</Sheet.Root>
	{#if workspaceView !== 'findings'}
		<div class="diff-toolbar">
			<FindingsBar>
				{#snippet trailing()}
					{#if backendReview}
						<Typography.Metadata class="review-state" role="status">
							{#if reviewing}<Spinner size={13} class="text-sev-medium" aria-hidden="true" />Review running{:else if backendReview.status === 'failed'}Review interrupted{:else if backendReview.status === 'draft'}Ready to review{:else}<Check size={14} class="text-success" aria-hidden="true" />Review complete{/if}
						</Typography.Metadata>
						<Button id="ask-review" variant="outline" class="gap-2" aria-pressed={showChat} aria-expanded={showChat} aria-controls="interactive-review" onclick={() => showChat ? void closeChat() : openChat()}><MessageSquare size={15} aria-hidden="true" />Ask reviewer</Button>
					{/if}
				{/snippet}
			</FindingsBar>
		</div>
	{/if}
	{#if filesError}
		<Alert.Root variant="error" class="mx-3 my-3 shrink-0"><Alert.Title>{filesError}</Alert.Title><Button variant="outline" class="mt-2 w-fit" onclick={() => filesRetryNonce++}>Retry loading diff</Button></Alert.Root>
	{/if}
	{#if backendError}
		<Alert.Root variant="error" class="mx-3 mt-3 shrink-0">
			<Alert.Title>Review data unavailable</Alert.Title>
			<Alert.Description>{backendDown ? `Review API unreachable (${backendError}) — showing local demo content.` : backendError}</Alert.Description>
			<Button variant="outline" class="mt-2 w-fit" onclick={() => (retryNonce += 1)}>Retry</Button>
		</Alert.Root>
	{/if}
			<div class="flex min-h-0 flex-1">
				{#if workspaceView === 'findings'}
					<div class="flex min-h-0 min-w-0 flex-1 {sidePanelOpen ? 'max-xl:hidden' : ''}">
						<FindingsFocus files={files} toolCalls={reviewStream?.progress.toolCalls ?? []} branch={recent?.branch}
							onFullFile={(finding) => { sessionFile.select(finding.file); userPickedFile = true; findingsStore.discuss(finding.id); setView('diff'); requestAnimationFrame(() => document.getElementById(`finding-${finding.id}`)?.scrollIntoView({ block: 'center' })); }} />
					</div>
				{:else}
				<div class="diff-tree hidden lg:block {sidePanelOpen ? 'max-2xl:!hidden' : ''}">
					<SessionSidebar fileDiffs={isBackend ? (backendFiles ?? []) : null} />
				</div>
				<div id="diff-panel" class="relative flex min-h-0 min-w-0 flex-1 flex-col {sidePanelOpen ? 'max-xl:hidden' : ''}">
					{#if isBackend && backendReview?.status === 'failed' && !backendFiles}
						<Alert.Root variant="error" class="m-4">
							<Alert.Title>Review failed</Alert.Title>
							<Alert.Description class="max-w-md">{backendReview.summary ?? 'The pipeline failed before producing a diff.'}</Alert.Description>
							<Alert.Description>Fix the cause, then restart the review from the conversation.</Alert.Description>
						</Alert.Root>
					{:else if isBackend && !backendFiles}
						<div class="diff-loading" role="status" aria-label="Fetching PR diff">
							<Typography.Metadata>Fetching PR diff…</Typography.Metadata>
							{#each ['w-11/12', 'w-full', 'w-4/5', 'w-full', 'w-3/5', 'w-5/6', 'w-11/12', 'w-2/3'] as width, i (i)}<Skeleton class="h-3.5 rounded-md {width}" />{/each}
						</div>
					{:else}
						<DiffFileHeader diff={fileDiff} />
						<ScrollArea orientation="vertical" aria-label="Code diff" class="min-h-0 flex-1" showCues={false}>
							{#key fileDiff.path}
								<div class="min-w-0 page-enter">
									<CodeDiff diff={fileDiff} findings={displayFindings} mode={diffPrefs.mode} onAsk={isBackend ? openChat : undefined} />
								</div>
							{/key}
						</ScrollArea>
					{/if}
				</div>
				{/if}
				{#if threadsStore.openId}
					{#key threadsStore.openId}
						<ThreadPanel />
					{/key}
				{:else if showChat && backendReview && reviewStream}
					<section id="interactive-review" aria-label="Interactive review" class="flex min-h-0 w-full min-w-0 flex-col xl:w-[420px] xl:shrink-0 2xl:w-[460px]">
						<Card.Root class="h-full !gap-0 overflow-hidden rounded-none border-0 border-s border-border-subtle bg-background !p-0 shadow-none">
							<header class="flex min-h-12 shrink-0 items-center gap-2 border-b border-border-subtle px-4">
								<Typography.Title level={2} class="min-w-0 flex-1 text-sm font-normal">Orchestrator</Typography.Title>
								<Button variant="ghost" size="icon" class="size-9" aria-label="Close review chat" onclick={() => void closeChat()}><X size={16} aria-hidden="true" /></Button>
							</header>
							{#if reviewStream.connection === 'reconnecting'}<Typography.Text role="status" class="px-4 py-2 text-sm text-warning">Reconnecting… Your conversation is saved.</Typography.Text>{/if}
							<ReviewConversation compact assignment={orchestrator} messages={reviewStream.progress.messages ?? []}
								reasoning={[]} toolCalls={[]} tasks={[]} active={reviewing} now={Date.now()}
								bind:draft={chatDraft} bind:codeContext focusKey={chatFocus}
								onSend={async (assignmentId, text, context) => { await serverApi.sendReviewMessage(id, assignmentId, text, context); }}
								onStop={async (assignmentId) => { await serverApi.stopReviewMessage(id, assignmentId); }} />
						</Card.Root>
					</section>
				{/if}
			</div>
	</div>
	{#if backendReview}<ReviewMetricsModal reviewId={backendReview.id} bind:open={usageOpen} showTrigger={false} />{/if}
{/snippet}
