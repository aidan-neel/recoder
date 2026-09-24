<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { tick, untrack } from 'svelte';
	import MessageSquare from '@lucide/svelte/icons/message-square';
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
	import PrChecks from '$lib/components/pr-checks.svelte';
	import CodeDiff from '$lib/components/code-diff.svelte';
	import ThreadPanel from '$lib/components/thread-panel.svelte';
	import ReviewConversation from '$lib/components/review-conversation.svelte';
	import { getFileDiff } from '$lib/diff';
	import { findingsStore, mapBackendFinding } from '$lib/findings.svelte';
	import { notesStore } from '$lib/notes.svelte';
	import { parseFixRequest, parseModelNotes } from '$lib/model-notes';
	import { errorToast } from '$lib/notify';
	import { threadsStore } from '$lib/threads.svelte';
	import { sessionState } from '$lib/session-state.svelte';
	import { DEFAULT_FILE, sessionFile } from '$lib/session-file.svelte';
	import { revealDiffLine } from '$lib/reveal-line';
	import { guidelinesStore } from '$lib/guidelines.svelte';
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
		if (!currentId || !status) return;
		const controller = new AbortController();
		let timer: ReturnType<typeof setTimeout> | undefined;
		// Drafts (interactive review) get their diff fetched in the background after creation.
		let loaded = false;
		async function loadFiles() {
			try {
				const files = await serverApi.getReviewFiles(currentId!, AbortSignal.any([controller.signal, AbortSignal.timeout(30_000)]));
				if (controller.signal.aborted || page.params.id !== currentId) return;
				backendFiles = files;
				filesError = null;
				loaded = true;
			} catch {
				if (controller.signal.aborted || page.params.id !== currentId) return;
				// A diff is not available during checkout or after an early failure.
				if (status === 'passed' || status === 'failed') filesError = 'Could not load the code diff. Try again.';
			} finally {
				if (!controller.signal.aborted && (status === 'queued' || status === 'running' || (status === 'draft' && !loaded))) timer = setTimeout(loadFiles, 2500);
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

	/* File tree width: draggable, remembered per browser. Kept in rem so it
	   scales with the root font size on large monitors. */
	const TREE_KEY = 'recoder.treeWidth';
	const TREE_MIN = 12.5;
	const TREE_MAX = 30;
	const TREE_DEFAULT = 18;
	let treeWidth = $state(TREE_DEFAULT);
	$effect(() => {
		try {
			const stored = Number(localStorage.getItem(TREE_KEY));
			if (stored >= TREE_MIN && stored <= TREE_MAX) treeWidth = stored;
		} catch {
			// Storage unavailable: default width.
		}
	});
	function setTreeWidth(rem: number): void {
		treeWidth = Math.min(TREE_MAX, Math.max(TREE_MIN, rem));
		try {
			localStorage.setItem(TREE_KEY, String(treeWidth));
		} catch {
			// Not persisted; the width still applies for this visit.
		}
	}
	function startTreeResize(event: PointerEvent): void {
		if (event.button !== 0) return;
		const handle = event.currentTarget as HTMLElement;
		handle.setPointerCapture(event.pointerId);
		const startX = event.clientX;
		const start = treeWidth;
		const rootPx = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
		document.documentElement.dataset.resizing = '';
		const move = (e: PointerEvent) => setTreeWidth(start + (e.clientX - startX) / rootPx);
		const end = () => {
			handle.removeEventListener('pointermove', move);
			handle.removeEventListener('pointerup', end);
			handle.removeEventListener('pointercancel', end);
			delete document.documentElement.dataset.resizing;
		};
		handle.addEventListener('pointermove', move);
		handle.addEventListener('pointerup', end);
		handle.addEventListener('pointercancel', end);
	}
	/* Chat drawer width: drag its left edge. Narrower than CHAT_COLLAPSE
	   collapses it; dragging back out (or Enter / double-click) reopens it. */
	const CHAT_KEY = 'recoder.chatWidth';
	const CHAT_MIN = 20;
	const CHAT_MAX = 45;
	const CHAT_DEFAULT = 26.25;
	const CHAT_COLLAPSE = 12;
	let chatWidth = $state(CHAT_DEFAULT);
	$effect(() => {
		try {
			const stored = Number(localStorage.getItem(CHAT_KEY));
			if (stored >= CHAT_MIN && stored <= CHAT_MAX) chatWidth = stored;
		} catch {
			// Storage unavailable: default width.
		}
	});
	function setChatWidth(rem: number): void {
		chatWidth = Math.min(CHAT_MAX, Math.max(CHAT_MIN, rem));
		try {
			localStorage.setItem(CHAT_KEY, String(chatWidth));
		} catch {
			// Not persisted; the width still applies for this visit.
		}
	}
	function startChatResize(event: PointerEvent): void {
		if (event.button !== 0) return;
		const handle = event.currentTarget as HTMLElement;
		handle.setPointerCapture(event.pointerId);
		const startX = event.clientX;
		const start = showChat ? chatWidth : 0;
		const rootPx = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
		let moved = false;
		document.documentElement.dataset.resizing = '';
		const move = (e: PointerEvent) => {
			const width = start + (startX - e.clientX) / rootPx;
			if (Math.abs(e.clientX - startX) > 3) moved = true;
			if (!moved) return;
			if (width < CHAT_COLLAPSE) {
				if (chatOpen) chatOpen = false;
				return;
			}
			if (!chatOpen) {
				threadsStore.close();
				chatOpen = true;
			}
			setChatWidth(width);
		};
		const end = () => {
			handle.removeEventListener('pointermove', move);
			handle.removeEventListener('pointerup', end);
			handle.removeEventListener('pointercancel', end);
			delete document.documentElement.dataset.resizing;
		};
		handle.addEventListener('pointermove', move);
		handle.addEventListener('pointerup', end);
		handle.addEventListener('pointercancel', end);
	}
	function chatResizeKey(event: KeyboardEvent): void {
		if (event.key === 'Enter' || event.key === ' ') {
			event.preventDefault();
			if (showChat) void closeChat();
			else openChat();
			return;
		}
		if (!showChat) {
			if (event.key === 'ArrowLeft') { event.preventDefault(); openChat(); }
			return;
		}
		const next = { ArrowLeft: chatWidth + 1, ArrowRight: chatWidth - 1, Home: CHAT_MAX, End: CHAT_MIN }[event.key];
		if (next === undefined) return;
		event.preventDefault();
		if (event.key === 'ArrowRight' && chatWidth <= CHAT_MIN) chatOpen = false;
		else setChatWidth(next);
	}

	function treeResizeKey(event: KeyboardEvent): void {
		const next = { ArrowLeft: treeWidth - 1, ArrowRight: treeWidth + 1, Home: TREE_MIN, End: TREE_MAX }[event.key];
		if (next === undefined) return;
		event.preventDefault();
		setTreeWidth(next);
	}
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

	/* Notes the model wrote on request (```recoder-note blocks in a finished
	   reply) become diff notes, once per reply. Cleared with the session. */
	const notedReplies = new Set<string>();

	/* Fixes the model was asked for (```recoder-fix in a finished reply) open the
	   Fix-all review for those findings, once per reply. The Findings view hosts
	   it, so switch there from the conversation. */
	const fixedReplies = new Set<string>();
	/** Only replies started after this page opened can trigger fixes (history never re-runs). */
	const openedAt = Date.now();
	$effect(() => {
		const finished = (reviewStream?.progress.messages ?? []).filter((message) =>
			message.from === 'assistant' && message.status === 'done' && message.text.includes('```recoder-fix')
			&& Date.parse(message.at) >= openedAt - 2000);
		if (!backendReview) return;
		untrack(() => {
			for (const message of finished) {
				if (fixedReplies.has(message.id)) continue;
				fixedReplies.add(message.id);
				const ids = parseFixRequest(message.text);
				if (!ids) continue;
				findingsStore.fixRequest = { key: message.id, ids };
				if (workspaceView === null) void setView('findings');
			}
		});
	});
	$effect(() => {
		const files = backendFiles;
		// Read status/text here (tracked): replies finish by updating in place.
		const finished = (reviewStream?.progress.messages ?? []).filter((message) =>
			message.from === 'assistant' && message.status === 'done' && message.text.includes('```recoder-note'));
		if (!files || !backendReview || finished.length === 0) return;
		untrack(() => {
			for (const message of finished) {
				if (notedReplies.has(message.id)) continue;
				notedReplies.add(message.id);
				for (const note of parseModelNotes(message.text)) {
					const file = files.find((f) => f.path === note.file) ?? files.find((f) => f.path.endsWith(`/${note.file}`) || note.file.endsWith(`/${f.path}`));
					if (!file) continue;
					const lines = file.hunks.flatMap((hunk) => hunk.lines).filter((line) => {
						const n = note.side === 'old' ? line.oldNo : line.newNo;
						return n !== null && n >= note.startLine && n <= note.endLine;
					});
					notesStore.add({
						file: file.path, startLine: note.startLine, endLine: note.endLine, side: note.side, body: note.body,
						quote: lines.map((line) => line.text).join('\n').slice(0, 2000)
					});
				}
			}
		});
	});
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
			chatOpen = page.url.searchParams.has('chat');
			chatDraft = '';
			codeContext = null;
			threadsStore.close();
			threadsStore.pendingMessage = null;
			notesStore.clear();
			notedReplies.clear();
			fixedReplies.clear();
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
		// Filters are read untracked: toggling a severity must not switch files.
		const open = findingsStore.items.filter(
			(f) => f.status !== 'dismissed' && untrack(() => findingsStore.isShown(f))
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
	/** Findings empty state: run a draft's full review directly. */
	async function startDraftReview(): Promise<void> {
		if (!backendReview) return;
		try {
			backendReview = await serverApi.startReview(backendReview.id);
		} catch (e) {
			errorToast('Could not start the review', e instanceof Error ? e.message : undefined);
		}
	}

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
	// Escape lets go of attached code first (from the composer or the diff), then collapses the chat.
	if (event.key === 'Escape' && !event.defaultPrevented && codeContext && showChat
		&& (document.activeElement?.closest('#interactive-review, #diff-panel') || document.activeElement === document.body)) {
		event.preventDefault();
		codeContext = null;
		return;
	}
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
		onOpenDiff={() => setDiffView(true)}
		onShowView={(view) => setView(view)}
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
	{#if backendReview && backendReview.source !== 'stub'}{@const repoId = backendReview.repoId}<DropdownMenu.Item callback={() => guidelinesStore.open({ kind: 'repo', repoId })}>Review guidelines</DropdownMenu.Item>{/if}
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
		toolbar={workspaceToolbar}
	/>
	<Sheet.Root bind:open={filesOpen}>
		<Sheet.Content side="left" class="w-[400px] max-w-[calc(100%-1rem)] [&>[data-ui=sheet-surface]]:bg-background [&>[data-ui=sheet-surface]]:p-0">
			<Sheet.Title class="sr-only">Changed files</Sheet.Title>
			<SessionSidebar inSheet fileDiffs={isBackend ? (backendFiles ?? []) : null} onFileSelect={() => filesOpen = false} />
		</Sheet.Content>
	</Sheet.Root>
	{#snippet workspaceToolbar()}
			<FindingsBar part="actions">
				{#snippet trailing()}
					{#if backendReview}
						{#if backendReview.source !== 'stub'}<PrChecks reviewId={backendReview.id} />{/if}
						{#if reviewing || backendReview.status === 'failed'}
							<Typography.Metadata class="review-state" role="status">
								{#if reviewing}<Spinner size={13} class="text-sev-medium" aria-hidden="true" />Review running{:else}Review interrupted{/if}
							</Typography.Metadata>
						{/if}
						<Button id="ask-review" variant="outline" class="gap-2" aria-pressed={showChat} aria-expanded={showChat} aria-controls="interactive-review" onclick={() => showChat ? void closeChat() : openChat()}><MessageSquare size={15} aria-hidden="true" />Ask reviewer</Button>
					{/if}
				{/snippet}
			</FindingsBar>
	{/snippet}
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
							status={!backendReview ? 'done' : reviewing ? 'running' : backendReview.status === 'draft' ? 'draft' : backendReview.status === 'failed' ? 'failed' : 'done'}
							onStartReview={backendReview?.status === 'draft' ? startDraftReview : null}
							onOpenDiff={() => setView('diff')}
							onAsk={isBackend ? () => openChat() : null}
							onConversation={() => setView('conversation')}
							onRestart={isBackend ? () => void rerunReview() : null}
							onOpenAt={(file, line) => { sessionFile.select(file); userPickedFile = true; void setView('diff').then(() => { if (line !== null) revealDiffLine(line); }); }}
							onFullFile={(finding) => { sessionFile.select(finding.file); userPickedFile = true; findingsStore.discuss(finding.id); setView('diff'); requestAnimationFrame(() => document.getElementById(`finding-${finding.id}`)?.scrollIntoView({ block: 'center' })); }} />
					</div>
				{:else}
				<div class="diff-tree hidden lg:block" data-beside-panel={sidePanelOpen || undefined} style="width: {treeWidth}rem">
					<SessionSidebar fileDiffs={isBackend ? (backendFiles ?? []) : null}>
						{#snippet header()}<FindingsBar part="nav" />{/snippet}
					</SessionSidebar>
					<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
					<div
						class="tree-resizer"
						role="separator"
						aria-orientation="vertical"
						aria-label="Resize file tree"
						aria-valuemin={TREE_MIN * 16}
						aria-valuemax={TREE_MAX * 16}
						aria-valuenow={Math.round(treeWidth * 16)}
						tabindex="0"
						onpointerdown={startTreeResize}
						onkeydown={treeResizeKey}
						ondblclick={() => setTreeWidth(TREE_DEFAULT)}
					></div>
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
									<CodeDiff diff={fileDiff} findings={displayFindings} mode={diffPrefs.mode} onAsk={isBackend ? openChat : undefined} activeRange={showChat ? codeContext : null} onClearRange={() => (codeContext = null)} />
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
				{:else if backendReview && reviewStream}
					<!-- Drawer: stays mounted; drag its left edge to resize, past the minimum to collapse, back out to reopen. -->
					<div class="chat-drawer" data-open={showChat || undefined} style="--chat-width: {chatWidth}rem">
						<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
						<div
							class="chat-resizer"
							role="separator"
							aria-orientation="vertical"
							aria-label={showChat ? 'Resize chat. Drag right to collapse.' : 'Chat collapsed. Drag left or press Enter to open.'}
							aria-controls="interactive-review"
							aria-valuemin={0}
							aria-valuemax={CHAT_MAX * 16}
							aria-valuenow={showChat ? Math.round(chatWidth * 16) : 0}
							tabindex="0"
							onpointerdown={startChatResize}
							onkeydown={chatResizeKey}
							ondblclick={() => (showChat ? void closeChat() : openChat())}
						></div>
						<div class="chat-drawer-clip">
							<section id="interactive-review" aria-label="Interactive review" class="chat-drawer-panel" inert={!showChat}>
								<Card.Root class="h-full !gap-0 overflow-hidden rounded-none border-0 border-s border-border-subtle bg-background !p-0 shadow-none">
									{#if reviewStream.connection === 'reconnecting'}<Typography.Text role="status" class="px-4 py-2 text-sm text-warning">Reconnecting… Your conversation is saved.</Typography.Text>{/if}
									<ReviewConversation compact assignment={orchestrator} messages={reviewStream.progress.messages ?? []}
										reasoning={[]} toolCalls={[]} tasks={[]} active={reviewing} now={Date.now()}
										bind:draft={chatDraft} bind:codeContext focusKey={chatFocus}
										onSend={async (assignmentId, text, context) => { await serverApi.sendReviewMessage(id, assignmentId, text, context); }}
										onStop={async (assignmentId) => { await serverApi.stopReviewMessage(id, assignmentId); }} />
								</Card.Root>
							</section>
						</div>
					</div>
				{/if}
			</div>
	</div>
	{#if backendReview}<ReviewMetricsModal reviewId={backendReview.id} bind:open={usageOpen} showTrigger={false} />{/if}
{/snippet}
