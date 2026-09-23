<script lang="ts">
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import Play from '@lucide/svelte/icons/play';
	import Plus from '@lucide/svelte/icons/plus';
	import RefreshCw from '@lucide/svelte/icons/refresh-cw';
	import Search from '@lucide/svelte/icons/search';
	import * as Alert from '@sivir-ui/svelte/components/alert';
	import { Badge } from '@sivir-ui/svelte/components/badge';
	import { Button } from '@sivir-ui/svelte/components/button';
	import * as HoverCard from '@sivir-ui/svelte/components/hover-card';
	import { Input } from '@sivir-ui/svelte/components/input';
	import { ScrollArea } from '@sivir-ui/svelte/components/scroll-area';
	import { Spinner } from '@sivir-ui/svelte/components/spinner';
	import { Switch } from '@sivir-ui/svelte/components/switch';
	import * as Tabs from '@sivir-ui/svelte/components/tabs';
	import * as Tooltip from '@sivir-ui/svelte/components/tooltip';
	import * as Typography from '@sivir-ui/svelte/components/typography';
	import type { PullPreview, PullRequest, Repo, Review } from '@recoder/shared';
	import PrRow from '$lib/components/pr-row.svelte';
	import ProviderMark from '$lib/components/provider-mark.svelte';
	import Skeleton from '$lib/components/ui/skeleton.svelte';
	import {
		briefSegments,
		dayPart,
		fallbackBrief,
		firstName,
		highCount,
		latestReviews,
		pickToOpen,
		pickToReview,
		prKey,
		prStatus,
		shortAge,
		type BriefPick
	} from '$lib/home';
	import { hoverHighlight } from '$lib/hover-highlight';
	import { modelSettingsUi } from '$lib/model-settings.svelte';
	import { errorToast } from '$lib/notify';
	import { openPrs } from '$lib/open-prs.svelte';
	import { recentSessions } from '$lib/recent-sessions.svelte';
	import { serverApi } from '$lib/server-api';
	import { sessionState } from '$lib/session-state.svelte';
	import { shellState } from '$lib/shell-state.svelte';

	const INTERACTIVE_KEY = 'recoder.interactiveReview';

	let filter = $state('');
	let repoChip = $state('all');
	let interactiveReview = $state(false);
	let filterEl = $state<HTMLInputElement>();
	/** Review request in flight, by `repoId#pr`. */
	let starting = $state<string | null>(null);
	/** Reviews started from Home this visit; they show the Done state when they finish. */
	let watching = $state<Set<string>>(new Set());
	let preview = $state<PullPreview | null>(null);
	let previewRepoId = $state<string | null>(null);
	let fetchingPreview = $state(false);
	let prError = $state<string | null>(null);
	let briefLoading = $state(false);
	let briefFailed = $state(false);

	onMount(() => {
		try {
			interactiveReview = localStorage.getItem(INTERACTIVE_KEY) === 'true';
		} catch {
			// Storage unavailable: default off.
		}
		void openPrs.load();
		void modelSettingsUi.load();
	});

	$effect(() => {
		try {
			localStorage.setItem(INTERACTIVE_KEY, String(interactiveReview));
		} catch {
			// Not persisted; the switch still works for this visit.
		}
	});

	const needsModel = $derived(!openPrs.apiDown && !!modelSettingsUi.config && !modelSettingsUi.config.configured);
	const latest = $derived(latestReviews(recentSessions.reviews));
	const repoById = $derived(new Map(openPrs.repos.map((repo) => [repo.id, repo] as const)));

	/** Every open PR with its repo and latest review; the brief and the actions read this. */
	const items = $derived.by<BriefPick[]>(() =>
		openPrs.repos.flatMap((repo) =>
			(openPrs.prsByRepo[repo.id] ?? []).map((pr) => ({ pr, repo, review: latest.get(prKey(repo.id, pr.number)) }))
		)
	);

	/* ── Filtering ─────────────────────────────────────────────── */

	function parsePrNumber(text: string): number | null {
		const trimmed = text.trim();
		if (trimmed === '') return null;
		const url = trimmed.match(/(?:pull|merge_requests)\/(\d+)/i);
		const digits = (url?.[1] ?? (/^#?\d+$/.test(trimmed) ? trimmed : '')).replace(/\D/g, '');
		if (digits === '') return null;
		const n = Number.parseInt(digits, 10);
		return Number.isSafeInteger(n) && n > 0 ? n : null;
	}

	/** The tracked repo a pasted PR belongs to (URL match), else the chip's repo, else the first. */
	function repoForPaste(text: string): Repo | undefined {
		const url = text.match(/(?:github|gitlab)\.com\/([^/\s]+)\/([^/\s#?]+)/i);
		if (url) {
			const slug = `${url[1]}/${url[2]}`.toLowerCase();
			return openPrs.repos.find((r) => r.name.toLowerCase() === slug || r.url.toLowerCase().includes(slug));
		}
		return repoById.get(repoChip) ?? openPrs.repos[0];
	}

	const query = $derived(filter.trim().toLowerCase());
	const pastedNumber = $derived(parsePrNumber(filter));
	const isUrl = $derived(/https?:\/\//i.test(filter));

	function matches(pr: PullRequest, repo: Repo): boolean {
		if (query === '') return true;
		if (isUrl) return pr.number === pastedNumber && repoForPaste(filter)?.id === repo.id;
		return (
			repo.name.toLowerCase().includes(query) ||
			`#${pr.number}`.includes(query) ||
			String(pr.number).includes(query) ||
			pr.title.toLowerCase().includes(query) ||
			pr.headRef.toLowerCase().includes(query) ||
			pr.author.toLowerCase().includes(query)
		);
	}

	const groups = $derived.by(() =>
		openPrs.repos
			.filter((repo) => repoChip === 'all' || repo.id === repoChip)
			.map((repo) => {
				let prs = (openPrs.prsByRepo[repo.id] ?? []).filter((pr) => matches(pr, repo));
				if (preview && previewRepoId === repo.id && !prs.some((pr) => pr.number === preview!.pr.number)) {
					prs = [preview.pr, ...prs];
				}
				prs = [...prs].sort((a, b) => (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0));
				return { repo, prs, loading: !!openPrs.loadingByRepo[repo.id], error: openPrs.errorByRepo[repo.id] };
			})
	);
	const listedGroups = $derived(groups.filter((g) => g.loading || g.error || g.prs.length > 0));
	const emptyRepos = $derived(query === '' ? groups.filter((g) => !g.loading && !g.error && g.prs.length === 0) : []);
	const anyLoading = $derived(groups.some((g) => g.loading));
	const matchTotal = $derived(groups.reduce((n, g) => n + g.prs.length, 0));
	const showFetch = $derived(
		pastedNumber !== null &&
			openPrs.repos.length > 0 &&
			!anyLoading &&
			!items.some((item) => item.pr.number === pastedNumber && item.repo.id === repoForPaste(filter)?.id) &&
			preview?.pr.number !== pastedNumber
	);

	async function fetchPreview(n: number): Promise<void> {
		const repo = repoForPaste(filter);
		if (!repo || fetchingPreview) return;
		fetchingPreview = true;
		prError = null;
		try {
			preview = await serverApi.previewPr(repo.id, n);
			previewRepoId = repo.id;
		} catch (e) {
			prError = e instanceof Error ? e.message : 'Could not fetch that pull request.';
		} finally {
			fetchingPreview = false;
		}
	}

	/* ── Sessions ──────────────────────────────────────────────── */

	/** `chat` opens the Orchestrator panel beside the diff (interactive review). */
	function openReview(review: Review, repo: Repo, diff = false, chat = false): void {
		const status = review.status === 'running' || review.status === 'queued' ? 'reviewing' : 'ready';
		sessionState.ensureSession(review.id, repo.name, `#${review.prNumber}`, status);
		void goto(`/session/${review.id}${diff ? `?view=diff${chat ? '&chat=1' : ''}` : ''}`);
	}

	/**
	 * Review queues an automated review. With Interactive review on it opens the
	 * diff right away; otherwise it runs from Home and gets a tab. Interactive
	 * opens a chat-first session with the Orchestrator.
	 */
	async function start(pr: PullRequest, repo: Repo, mode: 'review' | 'interactive'): Promise<void> {
		const key = prKey(repo.id, pr.number);
		if (starting) return;
		starting = key;
		prError = null;
		try {
			const review = await serverApi.queueReview({
				repoId: repo.id,
				prNumber: pr.number,
				start: mode === 'review',
				prTitle: pr.title
			});
			if (pr.headRef) recentSessions.branches[key] = pr.headRef;
			await recentSessions.refresh();
			if (mode === 'interactive' || interactiveReview) {
				openReview(review, repo, true, mode === 'interactive');
				return;
			}
			sessionState.ensureSession(review.id, repo.name, `#${pr.number}`, 'reviewing');
			watching = new Set(watching).add(key);
		} catch (e) {
			errorToast('Could not start the review', e instanceof Error ? e.message : undefined);
		} finally {
			starting = null;
		}
	}

	function openRow(pr: PullRequest, repo: Repo): void {
		const review = latest.get(prKey(repo.id, pr.number));
		if (review) openReview(review, repo);
		else void start(pr, repo, 'review');
	}

	function refreshAll(): void {
		void openPrs.refresh();
		void recentSessions.refresh();
	}

	/* ── Brief ─────────────────────────────────────────────────── */

	const name = $derived(firstName(shellState.account?.user));
	const part = $derived(dayPart());
	const reviewPick = $derived(pickToReview(items));
	const openPick = $derived(pickToOpen(items));
	const briefReady = $derived(openPrs.count !== null && !recentSessions.loading);
	/** Changes when the PR list or any of its review states change. */
	const briefKey = $derived(
		JSON.stringify([
			name,
			part,
			items.map((item) => [item.repo.id, item.pr.number, item.review?.status, item.review?.findings.length])
		])
	);
	let requestedKey = '';

	$effect(() => {
		if (!briefReady || openPrs.apiDown || needsModel) return;
		if (items.length === 0) {
			openPrs.brief = null;
			return;
		}
		const key = briefKey;
		if (key === requestedKey) return;
		requestedKey = key;
		const controller = new AbortController();
		briefLoading = true;
		briefFailed = false;
		serverApi
			.homeBrief(
				{
					name,
					dayPart: part,
					prs: items.map(({ pr, repo }) => ({
						repoId: repo.id,
						repo: repo.name,
						number: pr.number,
						title: pr.title,
						additions: pr.additions,
						deletions: pr.deletions,
						changedFiles: pr.changedFiles,
						createdAt: pr.createdAt
					})),
					emptyRepos: openPrs.repos.filter((repo) => (openPrs.prsByRepo[repo.id] ?? []).length === 0).map((repo) => repo.name)
				},
				controller.signal
			)
			.then((brief) => {
				openPrs.brief = brief;
			})
			.catch(() => {
				if (!controller.signal.aborted) briefFailed = true;
			})
			.finally(() => {
				if (!controller.signal.aborted) briefLoading = false;
			});
		return () => {
			controller.abort();
			requestedKey = '';
		};
	});

	const briefText = $derived(
		openPrs.brief && !briefFailed ? openPrs.brief.text : briefReady ? fallbackBrief(items, name, part) : null
	);
	const showBriefSkeleton = $derived(!openPrs.brief && (!briefReady || (briefLoading && !briefFailed)));
	const today = new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
	const updatedAt = $derived(
		openPrs.brief && !briefFailed
			? new Date(openPrs.brief.generatedAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
			: null
	);

	function focusFilter(event: KeyboardEvent): void {
		if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey) return;
		const target = event.target as HTMLElement | null;
		if (target?.closest('input, textarea, select, [contenteditable="true"], [role="dialog"]')) return;
		event.preventDefault();
		filterEl?.focus();
	}
</script>

<svelte:window onkeydown={focusFilter} />

{#snippet prRef(item: BriefPick, text: string)}
	{@const status = prStatus(item.review)}
	<HoverCard.Root openDelay={250}>
		<HoverCard.Trigger
			href={item.review ? `/session/${item.review.id}` : item.pr.url}
			class="brief-ref"
			{...item.review
				? { onclick: (event: MouseEvent) => { event.preventDefault(); if (item.review) openReview(item.review, item.repo); } }
				: { target: '_blank', rel: 'noopener noreferrer' }}
		>
			{text}
		</HoverCard.Trigger>
		<HoverCard.Content
			side="bottom"
			align="start"
			class="pr-card"
			{...{
				onclick: () => {
					if (item.review) openReview(item.review, item.repo);
					else window.open(item.pr.url, '_blank', 'noopener,noreferrer');
				}
			}}
		>
			<div class="flex items-center gap-2 font-mono text-[11.5px] text-fg-faint">
				<ProviderMark provider={item.repo.provider} size={12} />
				<span class="truncate">{item.repo.name}</span>
				<span>#{item.pr.number}</span>
			</div>
			<HoverCard.Title class="pr-card-title">{item.pr.title || `PR #${item.pr.number}`}</HoverCard.Title>
			<HoverCard.Description class="pr-card-meta">
				<span class="truncate text-fg-subtle">{item.pr.headRef}</span>
				<span aria-hidden="true">→</span>
				<span>{item.pr.base}</span>
			</HoverCard.Description>
			<div class="pr-card-meta">
				<span>{item.pr.changedFiles} file{item.pr.changedFiles === 1 ? '' : 's'}</span>
				<span class="text-ok">+{item.pr.additions}</span>
				<span class="text-danger">−{item.pr.deletions}</span>
				{#if item.pr.createdAt}<span aria-hidden="true">·</span><span>{shortAge(item.pr.createdAt)} old</span>{/if}
				<span aria-hidden="true">·</span><span class="truncate">{item.pr.author}</span>
			</div>
			<div class="mt-2 flex items-center justify-between gap-2">
				{#if status}
					<Badge variant="secondary" class="status-chip" data-tone={status.tone}>{status.label}</Badge>
				{:else}
					<span class="shimmer-text text-[12px]">Review running</span>
				{/if}
				<span class="text-[11.5px] text-fg-faint">{item.review ? 'Click to open the review' : 'Click to open on ' + (item.repo.provider === 'gitlab' ? 'GitLab' : 'GitHub')}</span>
			</div>
		</HoverCard.Content>
	</HoverCard.Root>
{/snippet}

{#snippet skeletonRows(n: number)}
	<div role="status" aria-label="Loading pull requests" class="flex flex-col border-t border-line-subtle">
		{#each Array(n) as _, i (i)}
			<div class="flex items-start gap-3.5 border-b border-line-subtle px-3 py-3.5">
				<Skeleton class="mt-0.5 size-4 shrink-0 rounded-full" />
				<div class="flex min-w-0 flex-1 flex-col gap-2">
					<Skeleton class="h-4 w-3/5" />
					<Skeleton class="h-3 w-2/5" />
				</div>
				<Skeleton class="h-5 w-16 rounded-md" />
			</div>
		{/each}
	</div>
{/snippet}

<ScrollArea class="h-full min-h-0" aria-label="Home" showCues={false}>
	<div class="home-column">
		{#if !openPrs.apiDown}
			<section aria-label="Brief" class="flex flex-col">
				<Typography.Metadata class="flex items-center gap-2 text-[12.5px] text-fg-faint">
					<span class="font-medium text-fg-muted">Brief</span>
					<span aria-hidden="true">·</span>
					<span>{today}</span>
					{#if updatedAt}
						<span aria-hidden="true">·</span>
						<span>updated {updatedAt}</span>
					{:else if briefLoading}
						<span aria-hidden="true">·</span>
						<span class="shimmer-text">updating</span>
					{/if}
				</Typography.Metadata>
				{#if showBriefSkeleton}
					<div class="mt-4 flex flex-col gap-3" role="status" aria-label="Writing the brief">
						<Skeleton class="h-6 w-[92%]" />
						<Skeleton class="h-6 w-[84%]" />
						<Skeleton class="h-6 w-[48%]" />
					</div>
				{:else if briefText}
					<Typography.Text class="home-brief ai-voice enter-rise">
						{#each briefSegments(briefText) as segment, i (i)}
							{#if segment.kind === 'strong'}
								<span class="text-fg">{segment.text}</span>
							{:else if segment.kind === 'pr' && items.some((item) => item.pr.number === segment.number)}
								{@const item = items.find((candidate) => candidate.pr.number === segment.number)!}
								{@render prRef(item, segment.text)}
							{:else}
								{segment.text}
							{/if}
						{/each}
					</Typography.Text>
				{/if}
				{#if briefReady && (reviewPick || openPick)}
					<div class="mt-[22px] flex flex-wrap gap-2">
						{#if reviewPick}
							{@const pick = reviewPick}
							<Button
								class="brief-action"
								loading={starting === prKey(pick.repo.id, pick.pr.number)}
								onclick={() => void start(pick.pr, pick.repo, 'review')}
							>
								<Play size={12} fill="currentColor" aria-hidden="true" />
								Review #{pick.pr.number}
							</Button>
						{/if}
						{#if openPick?.review}
							{@const pick = openPick}
							<Button variant="outline" class="brief-action" onclick={() => pick.review && openReview(pick.review, pick.repo)}>
								Open #{pick.pr.number}
								<Badge variant="secondary" data-sev="high" class="severity-pill font-mono">{highCount(pick.review)} high</Badge>
							</Button>
						{/if}
					</div>
				{/if}
			</section>
		{/if}

		<div class="mt-11 flex items-center gap-2">
			<div class="home-filter min-w-0 flex-1">
				<Input
					id="home-filter"
					bind:element={filterEl}
					placeholder="Filter open PRs, or paste a URL"
					aria-label="Filter open PRs, or paste a URL"
					bind:value={filter}
					disabled={openPrs.repos.length === 0}
					oninput={() => {
						prError = null;
						preview = null;
						previewRepoId = null;
					}}
				>
					{#snippet leading()}
						<Search size={16} strokeWidth={1.75} aria-hidden="true" />
					{/snippet}
					{#snippet trailing()}
						<kbd class="keycap" aria-hidden="true">/</kbd>
					{/snippet}
				</Input>
			</div>
			<Tooltip.Root delay={600}>
				<Tooltip.Trigger class="flex shrink-0">
					<Button
						variant="outline"
						size="icon"
						class="home-refresh"
						aria-label="Refresh pull requests"
						aria-busy={openPrs.refreshing}
						disabled={openPrs.refreshing || openPrs.repos.length === 0}
						onclick={refreshAll}
					>
						{#if openPrs.refreshing}<Spinner size={16} />{:else}<RefreshCw size={16} strokeWidth={1.75} aria-hidden="true" />{/if}
					</Button>
				</Tooltip.Trigger>
				<Tooltip.Content>Refresh</Tooltip.Content>
			</Tooltip.Root>
		</div>

		<div class="mt-3.5 flex flex-wrap items-center gap-x-4 gap-y-2">
			{#if openPrs.repos.length > 0}
				<Tabs.Root value={repoChip} onValueChange={(value) => (repoChip = value)} variant="segmented" class="repo-chips">
					<Tabs.List {...{ 'aria-label': 'Filter by repository' }}>
						<Tabs.Trigger value="all">
							All
							{#if openPrs.count !== null}<span class="chip-count">{openPrs.count}</span>{/if}
						</Tabs.Trigger>
						{#each openPrs.repos as repo (repo.id)}
							{@const n = openPrs.prsByRepo[repo.id]?.length}
							<Tabs.Trigger value={repo.id} {...{ 'data-empty': n === 0 || undefined, title: repo.name }}>
								<ProviderMark provider={repo.provider} size={14} />
								{repo.name.split('/').pop()}
								{#if n !== undefined}<span class="chip-count">{n}</span>{/if}
							</Tabs.Trigger>
						{/each}
					</Tabs.List>
				</Tabs.Root>
			{/if}
			<span class="flex-1"></span>
			<span class="home-switch"><Switch bind:switched={interactiveReview} label="Interactive review" /></span>
		</div>

		{#if openPrs.apiDown}
			<Alert.Root variant="warning" class="mt-6">
				<Alert.Title>Can't reach the review server</Alert.Title>
				<Alert.Description>
					Start it with <code class="font-mono">bun run dev:server</code>, then refresh.
				</Alert.Description>
			</Alert.Root>
		{:else if needsModel}
			<Alert.Root variant="warning" class="mt-6">
				<Alert.Title>No reviewer model configured</Alert.Title>
				<Alert.Description>Reviews need at least one model.</Alert.Description>
				<Button variant="outline" class="mt-2 w-fit" onclick={() => modelSettingsUi.show()}>Open model settings</Button>
			</Alert.Root>
		{/if}

		{#if prError}
			<p class="mt-4 text-[13px] text-danger" role="alert">{prError}</p>
		{/if}

		{#if showFetch && pastedNumber !== null}
			<div class="mt-4 flex items-center gap-3 px-1">
				<p class="min-w-0 flex-1 truncate font-mono text-[12.5px] text-fg-faint">
					#{pastedNumber} isn't in the open list.
				</p>
				<Button variant="outline" loading={fetchingPreview} onclick={() => void fetchPreview(pastedNumber)}>Fetch</Button>
			</div>
		{/if}

		<div class="mt-[30px] flex flex-col gap-7" aria-busy={anyLoading || openPrs.loading}>
			{#if openPrs.loading}
				{@render skeletonRows(3)}
			{:else}
				{#each listedGroups as group, gi (group.repo.id)}
					<section class="flex min-w-0 flex-col" aria-label="Pull requests in {group.repo.name}">
						<Typography.H2 class="group-head">
							<ProviderMark provider={group.repo.provider} size={14} />
							<span class="truncate font-mono">{group.repo.name}</span>
							{#if !group.loading}<span class="font-mono text-fg-ghost">{group.prs.length}</span>{/if}
						</Typography.H2>
						{#if group.loading}
							{@render skeletonRows(2)}
						{:else if group.error}
							<Alert.Root variant="error">
								<Alert.Title>Could not load pull requests</Alert.Title>
								<Alert.Description>{group.error}</Alert.Description>
								<Button variant="outline" class="mt-2 w-fit" onclick={() => void openPrs.loadRepo(group.repo)}>Retry</Button>
							</Alert.Root>
						{:else}
							<div class="pr-list" {@attach hoverHighlight({ items: '.pr-row', class: 'hl-row' })}>
								{#each group.prs as pr, i (pr.number)}
									{@const key = prKey(group.repo.id, pr.number)}
									{@const review = latest.get(key)}
									<div class="enter-rise" style:--i={gi * 3 + i}>
										<PrRow
											{pr}
											{review}
											progress={review ? recentSessions.summaries[review.id] : undefined}
											starting={starting === key}
											justFinished={watching.has(key) && !!review && (review.status === 'passed' || review.status === 'failed')}
											highlighted={previewRepoId === group.repo.id && preview?.pr.number === pr.number}
											disabled={!!starting && starting !== key}
											onOpen={() => openRow(pr, group.repo)}
											onReview={() => void start(pr, group.repo, 'review')}
											onInteractive={() => void start(pr, group.repo, 'interactive')}
										/>
									</div>
								{/each}
							</div>
						{/if}
					</section>
				{/each}

				{#each emptyRepos as group (group.repo.id)}
					<p class="flex items-center gap-2 px-1 text-[12.5px] text-fg-ghost">
						<ProviderMark provider={group.repo.provider} size={14} />
						<span class="font-mono">{group.repo.name}</span>
						<span>· no open pull requests</span>
					</p>
				{/each}

				{#if openPrs.repos.length === 0 && !openPrs.apiDown}
					<div class="flex flex-col items-start gap-3 px-1">
						<Typography.Text variant="supporting">Track a repository to see its open pull requests.</Typography.Text>
						<Button variant="outline" onclick={() => modelSettingsUi.show('connections')}>
							<Plus size={14} aria-hidden="true" /> Track a repository
						</Button>
					</div>
				{:else if query !== '' && matchTotal === 0 && !anyLoading && !showFetch}
					<p class="px-1 text-[13px] text-fg-faint">No open pull requests match “{filter.trim()}”.</p>
				{/if}
			{/if}
		</div>
	</div>
</ScrollArea>
