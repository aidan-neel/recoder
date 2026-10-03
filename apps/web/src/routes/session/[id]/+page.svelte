<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { untrack } from 'svelte';
	import MessageSquare from '@lucide/svelte/icons/message-square';
	import { Button } from '@sivir-ui/svelte/components/button';
	import * as Alert from '@sivir-ui/svelte/components/alert';
	import * as DropdownMenu from '@sivir-ui/svelte/components/dropdown-menu';
	import * as Typography from '@sivir-ui/svelte/components/typography';
	import SessionSkeleton from '$lib/components/session/session-skeleton.svelte';
	import LiveReviewProgress from '$lib/components/review/live-review-progress.svelte';
	import ReviewProgress from '$lib/components/review/review-progress.svelte';
	import ReviewHeaderStatus from '$lib/components/review/review-header-status.svelte';
	import SessionHeader, { type SessionView } from '$lib/components/session/session-header.svelte';
	import SessionChatDrawer from '$lib/components/session/session-chat-drawer.svelte';
	import SessionDiffPane from '$lib/components/session/session-diff-pane.svelte';
	import SessionFindingsPane from '$lib/components/session/session-findings-pane.svelte';
	import { diffPrefs } from '$lib/diff/diff-prefs.svelte';
	import FindingsBar from '$lib/components/findings/findings-bar.svelte';
	import ThreadPanel from '$lib/components/findings/thread-panel.svelte';
	import { getFileDiff } from '$lib/diff/diff';
	import { findingsStore } from '$lib/findings/findings.svelte';
	import { notesStore } from '$lib/findings/notes.svelte';
	import { threadsStore } from '$lib/findings/threads.svelte';
	import { sessionState } from '$lib/session/session-state.svelte';
	import { DEFAULT_FILE, sessionFile } from '$lib/session/session-file.svelte';
	import { guidelinesStore } from '$lib/settings/guidelines.svelte';
	import { recentSessions } from '$lib/session/recent-sessions.svelte';
	import { closeSessionTab } from '$lib/session/session-tabs';
	import { scopePalette } from '$lib/session/session-palette.svelte';
	import { FileFocus, findingLines } from '$lib/session/file-focus.svelte';
	import { SessionFindings } from '$lib/session/session-findings.svelte';
	import { PanelWidth } from '$lib/session/panel-width.svelte';
	import { SessionChat } from '$lib/session/session-chat.svelte';
	import { SessionReview } from '$lib/session/session-review.svelte';
	import { collapseFileDiff, type FileDiff, type ReviewCodeContext } from '@recoder/shared';

	const id = $derived(page.params.id ?? '');
	const session = $derived(sessionState.sessions.find((s) => s.id === id));

	/** Keeps the top-bar tab highlight in sync with the route (direct loads, back/forward, recent-session jumps). */
	function syncActiveTab(): void {
		if (session && sessionState.activeId !== session.id) {
			sessionState.select(session.id);
		}
	}

	$effect(syncActiveTab);

	const data = new SessionReview(() => id);

	/** Review (the conversation), Findings (focus mode) or Diff (inline mode), kept in the URL. */
	const workspaceView = $derived.by((): 'findings' | 'diff' | null => {
		const view = page.url.searchParams.get('view');

		return view === 'findings' || view === 'diff' ? view : null;
	});

	const peekDiff = $derived(workspaceView !== null);

	function setView(view: SessionView, replaceState = false): Promise<void> {
		const url = new URL(page.url);

		if (view === 'conversation') url.searchParams.delete('view');
		else url.searchParams.set('view', view);

		return goto(`${url.pathname}${url.search}`, { noScroll: true, keepFocus: true, replaceState });
	}

	/** The review whose view default already applied during this visit. */
	let findingsDefaultFor: string | null = null;

	/**
	 * A finished review opens on Findings once per session visit, so choosing Review sticks. Drafts and failed reviews
	 * open on the review, where their next step is; a review that finishes while you watch stays put.
	 */
	function openFinishedOnFindings(): void {
		const review = data.review;

		if (!review || findingsDefaultFor === review.id) return;
		findingsDefaultFor = review.id;
		if (review.status === 'passed' && !page.url.searchParams.get('view')) untrack(() => void setView('findings', true));
	}

	/** A running review is one page: Findings and Diff open once it finishes. */
	function holdRunningOnReview(): void {
		if (data.reviewing && workspaceView !== null) untrack(() => void setView('conversation', true));
	}

	$effect(openFinishedOnFindings);
	$effect(holdRunningOnReview);

	function setDiffView(open: boolean): void {
		void setView(open ? 'diff' : 'conversation');
	}

	$effect(() => diffPrefs.useReview(data.review?.id ?? null));

	const chat = new SessionChat();
	const treeWidth = new PanelWidth('recoder.treeWidth', 12.5, 30, 18);

	$effect(() => treeWidth.load());
	$effect(() => chat.width.load());

	/** Findings starts with Ask reviewer collapsed; it opens on request. */
	function collapseChatOnFindings(): void {
		if (workspaceView === 'findings')
			untrack(() => {
				chat.open = false;
			});
	}

	$effect(collapseChatOnFindings);

	const sidePanelOpen = $derived(!!threadsStore.openId || chat.shown);

	/** Opens Ask reviewer; code attached from the diff also pins that file. */
	function openChat(context?: ReviewCodeContext): void {
		if (context) focus.userPicked = true;
		chat.show(context);
	}

	scopePalette(data, setDiffView);

	const findings = new SessionFindings(data);

	const liveDiff = $derived.by(() => {
		if (!data.files) return null;

		return data.files.find((f) => f.path === sessionFile.currentId) ?? data.files[0] ?? null;
	});

	/** Files arrive expanded to the whole file; the diff view trims them back to the changes, keeping lines with findings. */
	const fileDiff = $derived.by((): FileDiff => {
		if (!data.isBackend) return getFileDiff(sessionFile.currentId);
		if (liveDiff) return diffPrefs.fullFile ? liveDiff : collapseFileDiff(liveDiff, findingLines(liveDiff.path));

		return { path: sessionFile.currentId, additions: 0, deletions: 0, hunks: [] };
	});

	const displayFindings = $derived(findingsStore.forFile(sessionFile.currentId));

	let resetSessionId: string | null = null;

	/** Opening another session drops the previous one's file and findings at once, so stale content never flashes. */
	function resetForSession(): void {
		const currentId = id;

		if (resetSessionId === currentId) return;
		resetSessionId = currentId;

		untrack(() => {
			focus.reset();
			findings.reset();
			chat.reset(page.url.searchParams.has('chat'));
			threadsStore.close();
			threadsStore.pendingMessage = null;
			notesStore.clear();
			sessionFile.select(DEFAULT_FILE);
			findingsStore.replaceAll([]);
		});
	}

	$effect(resetForSession);

	const focus = new FileFocus(data, () => workspaceView);

	/** Shows the started review's findings, which also stops the visit default from re-running for it. */
	function openFindingsOf(reviewId: string | null): void {
		if (!reviewId) return;
		findingsDefaultFor = reviewId;
		void setView('findings');
	}

	async function startDraftReview(): Promise<void> {
		openFindingsOf(await data.startDraft());
	}

	async function continueReview(): Promise<void> {
		openFindingsOf(await data.resume());
	}

	function rerunReview(): void {
		void data.rerun(session?.name ?? 'session');
	}
</script>

<svelte:window onkeydown={chat.onWindowKeydown} />

{#if !data.checked || (data.review && !data.stream?.ready)}
	{@const loadingView = page.url.searchParams.get('view')}
	<SessionSkeleton
		view={loadingView === 'findings' || loadingView === 'diff'
			? loadingView
			: page.url.searchParams.get('agent')
				? 'specialist'
				: 'conversation'}
	/>
{:else if data.down && !data.review}
	<div class="mx-auto flex h-full w-full max-w-[776px] flex-col justify-center px-4 sm:px-6">
		<Alert.Root variant="error">
			<Alert.Title>Could not load session</Alert.Title>
			<Alert.Description>{data.error}</Alert.Description>
			<Button variant="outline" class="mt-3 w-fit" onclick={() => data.retryNonce++}>Retry</Button>
		</Alert.Root>
	</div>
{:else if !session}
	<div class="mx-auto flex min-h-[calc(100dvh-4rem)] w-full max-w-md flex-col justify-center px-4">
		<Typography.Title level={1} class="text-lg font-semibold tracking-tight">Session not found</Typography.Title>
		<Button href="/" class="mt-4 w-fit font-sans">Start a review</Button>
	</div>
{:else if !data.isBackend && session.status === 'reviewing'}
	<ReviewProgress
		title={`${session.ref ?? session.name} · ${session.name}`}
		repo={session.name}
		prLabel={session.ref}
		onDone={() => sessionState.markReady(session.id)}
	/>
{:else if data.review && data.stream}
	<div class="flex h-full flex-col" class:hidden={peekDiff}>
		{@render filesErrorAlert('mx-4 mt-2 shrink-0')}
		<div class="min-h-0 flex-1">
			{#key data.review.id}
				<LiveReviewProgress
					review={data.review}
					stream={data.stream}
					repo={session.name}
					files={data.stats?.files ?? null}
					additions={data.stats?.additions ?? null}
					deletions={data.stats?.deletions ?? null}
					onOpenDiff={() => setDiffView(true)}
					onShowView={(view) => setView(view)}
					onOpenFinding={(finding) => {
						if (finding.file) focus.pick(finding.file);
						setDiffView(true);
					}}
					onRestart={rerunReview}
					onStartReview={data.review?.status === 'draft' ? startDraftReview : null}
					onContinue={data.review?.status === 'failed' ? continueReview : null}
					restarting={data.queueing}
					actionError={data.error}
				/>
			{/key}
		</div>
	</div>
	{#if peekDiff}{@render diffWorkspace()}{/if}
{:else}
	{@render diffWorkspace()}
{/if}

{#snippet filesErrorAlert(className: string)}
	{#if data.filesError}
		<Alert.Root variant="error" class={className}>
			<Alert.Title>{data.filesError}</Alert.Title>
			<Button variant="outline" class="mt-2 w-fit" onclick={() => data.filesRetryNonce++}>Retry loading diff</Button>
		</Alert.Root>
	{/if}
{/snippet}

{#snippet diffMenu()}
	{#if data.review}<DropdownMenu.Item callback={() => setDiffView(false)}>Show review</DropdownMenu.Item>{/if}
	{#if data.review && data.review.source !== 'stub'}{@const repoId = data.review.repoId}<DropdownMenu.Item
			callback={() => guidelinesStore.open({ kind: 'repo', repoId })}>Review guidelines</DropdownMenu.Item
		>{/if}
	<DropdownMenu.Separator />
	<DropdownMenu.Item callback={() => void closeSessionTab(id)}>Close tab</DropdownMenu.Item>
{/snippet}

{#snippet workspaceToolbar()}
	<FindingsBar part="actions">
		{#snippet trailing()}
			{#if data.review}
				{#if data.review.status === 'failed'}
					<Typography.Metadata class="review-state" role="status">Review interrupted</Typography.Metadata>
				{/if}
				{#if data.review.status === 'passed'}<Button
						id="ask-review"
						variant="outline"
						class="gap-2"
						aria-pressed={chat.shown}
						aria-expanded={chat.shown}
						aria-controls="interactive-review"
						onclick={() => chat.toggle()}><MessageSquare size={15} aria-hidden="true" />Ask reviewer</Button
					>{/if}
			{/if}
		{/snippet}
	</FindingsBar>
{/snippet}

{#snippet workspaceStatus()}
	{#if data.review}<ReviewHeaderStatus reviewId={data.review.id} checks={data.review.source !== 'stub'} />{/if}
{/snippet}

{#snippet diffWorkspace()}
	{@const files = data.files ?? (data.isBackend ? [] : [fileDiff])}
	{@const recent = recentSessions.recent.find((item) => item.id === id)}
	<div class="review-workspace flex h-full min-h-0 flex-col">
		<SessionHeader
			title={data.review?.prTitle || session?.name || 'Review'}
			branch={recent?.branch}
			repo={recent?.repo ?? session?.name}
			prLabel={data.review ? `#${data.review.prNumber}` : session?.ref}
			prUrl={data.review?.prUrl}
			files={files.length}
			additions={files.reduce((sum, file) => sum + file.additions, 0)}
			deletions={files.reduce((sum, file) => sum + file.deletions, 0)}
			view={workspaceView ?? 'diff'}
			onView={data.review ? setView : null}
			menu={diffMenu}
			toolbar={workspaceToolbar}
			status={workspaceStatus}
		/>
		{@render filesErrorAlert('mx-3 my-3 shrink-0')}
		{#if data.error}
			<Alert.Root variant="error" class="mx-3 mt-3 shrink-0">
				<Alert.Title>Review data unavailable</Alert.Title>
				<Alert.Description
					>{data.down
						? `Review API unreachable (${data.error}) — showing local demo content.`
						: data.error}</Alert.Description
				>
				<Button variant="outline" class="mt-2 w-fit" onclick={() => (data.retryNonce += 1)}>Retry</Button>
			</Alert.Root>
		{/if}
		<div class="flex min-h-0 flex-1">
			{#if workspaceView === 'findings'}
				<SessionFindingsPane
					{data}
					{focus}
					{files}
					{sidePanelOpen}
					onView={setView}
					onAsk={() => openChat()}
					onStartReview={startDraftReview}
					onRestart={rerunReview}
				/>
			{:else}
				<SessionDiffPane
					{data}
					{treeWidth}
					{sidePanelOpen}
					diff={fileDiff}
					findings={displayFindings}
					activeRange={chat.shown ? chat.codeContext : null}
					onAsk={data.isBackend && data.review?.status === 'passed' ? openChat : undefined}
					onClearRange={() => (chat.codeContext = null)}
				/>
			{/if}
			{#if threadsStore.openId}
				{#key threadsStore.openId}
					<ThreadPanel />
				{/key}
			{:else if data.review && data.stream}
				<SessionChatDrawer
					{data}
					review={data.review}
					stream={data.stream}
					{chat}
					{focus}
					repo={session?.name ?? ''}
					onView={setView}
					onStartReview={startDraftReview}
					onContinue={continueReview}
					onRestart={rerunReview}
				/>
			{/if}
		</div>
	</div>
{/snippet}
