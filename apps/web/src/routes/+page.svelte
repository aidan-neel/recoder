<script lang="ts">
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import RefreshCw from '@lucide/svelte/icons/refresh-cw';
	import Search from '@lucide/svelte/icons/search';
	import * as Alert from '@sivir-ui/svelte/components/alert';
	import { Button } from '@sivir-ui/svelte/components/button';
	import { Input } from '@sivir-ui/svelte/components/input';
	import { ScrollArea } from '@sivir-ui/svelte/components/scroll-area';
	import { Spinner } from '@sivir-ui/svelte/components/spinner';
	import * as Tabs from '@sivir-ui/svelte/components/tabs';
	import { keepPillAligned } from '$lib/shell/tab-pill';
	import * as Tooltip from '@sivir-ui/svelte/components/tooltip';
	import * as Typography from '@sivir-ui/svelte/components/typography';
	import {
		latestReviews,
		type ProviderAuth,
		type PullPreview,
		type PullRequest,
		type Repo,
		type Review
	} from '@recoder/shared';
	import HomeBrief from '$lib/components/home/home-brief.svelte';
	import PrRow from '$lib/components/home/pr-row.svelte';
	import PrSkeletonRows from '$lib/components/home/pr-skeleton-rows.svelte';
	import ProviderMark from '$lib/components/settings/provider-mark.svelte';
	import SetupChecklist from '$lib/components/home/setup-checklist.svelte';
	import Skeleton from '$lib/components/ui/skeleton.svelte';
	import { prKey, type BriefPick } from '$lib/home/home';
	import { matchesPr, parsePrNumber, repoForPaste } from '$lib/home/pr-filter';
	import { hoverHighlight } from '$lib/shell/hover-highlight';
	import { modelSettingsUi } from '$lib/settings/model-settings.svelte';
	import { errorToast } from '$lib/shell/notify';
	import { openPrs } from '$lib/home/open-prs.svelte';
	import { recentSessions } from '$lib/session/recent-sessions.svelte';
	import { serverApi } from '$lib/api/server-api';
	import { sessionState } from '$lib/session/session-state.svelte';

	let filter = $state('');
	let repoChip = $state('all');
	let filterEl = $state<HTMLInputElement>();

	/** Review request in flight, by `repoId#pr`. */
	let starting = $state<string | null>(null);

	let preview = $state<PullPreview | null>(null);
	let previewRepoId = $state<string | null>(null);
	let fetchingPreview = $state(false);
	let prError = $state<string | null>(null);

	onMount(() => {
		void openPrs.load();
		void modelSettingsUi.load();
		void loadAuth();
	});

	let auth = $state<{ github: ProviderAuth; gitlab: ProviderAuth } | null>(null);

	/** Reads provider sign-in; unknown reads as not connected, and a tracked repo still counts. */
	async function loadAuth(): Promise<void> {
		try {
			auth = await serverApi.authStatus();
		} catch {
			const none = (provider: 'github' | 'gitlab'): ProviderAuth => ({
				provider,
				available: false,
				authenticated: false,
				user: null
			});

			auth = { github: none('github'), gitlab: none('gitlab') };
		}
	}

	/** Settings is where every setup step happens, so auth is rechecked when it closes. */
	let settingsWasOpen = false;

	$effect(() => {
		const open = modelSettingsUi.open;

		if (settingsWasOpen && !open) void loadAuth();
		settingsWasOpen = open;
	});

	/** Swap Home for the checklist until a review can actually run. */
	const needsSetup = $derived(
		!openPrs.apiDown &&
			!openPrs.loading &&
			!!auth &&
			!!modelSettingsUi.config &&
			(!modelSettingsUi.config.configured || openPrs.repos.length === 0)
	);

	const needsModel = $derived(!openPrs.apiDown && !!modelSettingsUi.config && !modelSettingsUi.config.configured);
	const latest = $derived(latestReviews(recentSessions.reviews));

	/** Every open PR with its repo and latest review; the brief and the actions read this. */
	const items = $derived.by<BriefPick[]>(() =>
		openPrs.repos.flatMap((repo) =>
			(openPrs.prsByRepo[repo.id] ?? []).map((pr) => ({ pr, repo, review: latest.get(prKey(repo.id, pr.number)) }))
		)
	);

	const query = $derived(filter.trim().toLowerCase());
	const pastedNumber = $derived(parsePrNumber(filter));
	const isUrl = $derived(/https?:\/\//i.test(filter));

	/** The tracked repo a pasted PR belongs to, falling back to the chosen repo chip. */
	const pastedRepo = $derived(
		repoForPaste(
			filter,
			openPrs.repos,
			openPrs.repos.find((repo) => repo.id === repoChip)
		)
	);

	const groups = $derived.by(() =>
		openPrs.repos
			.filter((repo) => repoChip === 'all' || repo.id === repoChip)
			.map((repo) => {
				let prs = (openPrs.prsByRepo[repo.id] ?? []).filter((pr) =>
					matchesPr(pr, repo, { query, isUrl, pastedNumber, pastedRepo })
				);

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
			!items.some((item) => item.pr.number === pastedNumber && item.repo.id === pastedRepo?.id) &&
			preview?.pr.number !== pastedNumber
	);

	async function fetchPreview(n: number): Promise<void> {
		const repo = pastedRepo;

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

	/** Every review opens on its conversation. */
	function openReview(review: Review, repo: Repo): void {
		const status = review.status === 'running' || review.status === 'queued' ? 'reviewing' : 'ready';

		sessionState.ensureSession(review.id, repo.name, `#${review.prNumber}`, status);
		void goto(`/session/${review.id}`);
	}

	/** Queue a review and open its conversation right away. */
	async function start(pr: PullRequest, repo: Repo): Promise<void> {
		const key = prKey(repo.id, pr.number);

		if (starting) return;
		starting = key;
		prError = null;

		try {
			const review = await serverApi.queueReview({
				repoId: repo.id,
				prNumber: pr.number,
				start: true,
				prTitle: pr.title
			});

			if (pr.headRef) recentSessions.branches[key] = pr.headRef;
			await recentSessions.refresh();
			openReview(review, repo);
		} catch (e) {
			errorToast('Could not start the review', e instanceof Error ? e.message : undefined);
		} finally {
			starting = null;
		}
	}

	function openRow(pr: PullRequest, repo: Repo): void {
		const review = latest.get(prKey(repo.id, pr.number));

		if (review) openReview(review, repo);
		else void start(pr, repo);
	}

	function refreshAll(): void {
		void openPrs.refresh();
		void recentSessions.refresh();
	}

	function focusFilter(event: KeyboardEvent): void {
		if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey) return;

		const target = event.target as HTMLElement | null;

		if (target?.closest('input, textarea, select, [contenteditable="true"], [role="dialog"]')) return;
		event.preventDefault();
		filterEl?.focus();
	}
</script>

<svelte:window onkeydown={focusFilter} />

<ScrollArea class="h-full min-h-0" aria-label="Home" showCues={false}>
	{#if needsSetup && auth}
		<SetupChecklist {auth} repoCount={openPrs.repos.length} />
	{:else}
		<div class="home-column">
			{#if !openPrs.apiDown}
				<HomeBrief {items} {needsModel} {starting} onStart={(pr, repo) => void start(pr, repo)} onOpen={openReview} />
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
							{#if openPrs.refreshing}<Spinner size={16} />{:else}<RefreshCw
									size={16}
									strokeWidth={1.75}
									aria-hidden="true"
								/>{/if}
						</Button>
					</Tooltip.Trigger>
					<Tooltip.Content>Refresh</Tooltip.Content>
				</Tooltip.Root>
			</div>

			<div class="mt-3.5 flex flex-wrap items-center gap-x-4 gap-y-2">
				{#if openPrs.repos.length > 0}
					<Tabs.Root
						value={repoChip}
						onValueChange={(value) => (repoChip = value)}
						variant="segmented"
						class="repo-chips"
					>
						<Tabs.List {...{ 'aria-label': 'Filter by repository' }} {@attach keepPillAligned}>
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
				{:else if openPrs.loading}
					<Skeleton class="h-[30px] w-56" />
				{/if}
				<span class="flex-1"></span>
			</div>

			{#if openPrs.apiDown}
				<Alert.Root variant="warning" class="mt-6">
					<Alert.Title>Can't reach the review server</Alert.Title>
					<Alert.Description>
						Start it with <code class="font-mono">bun run dev:server</code>, then refresh.
					</Alert.Description>
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
					<Button variant="outline" loading={fetchingPreview} onclick={() => void fetchPreview(pastedNumber)}
						>Fetch</Button
					>
				</div>
			{/if}

			<div class="mt-[30px] flex flex-col gap-7" aria-busy={anyLoading || openPrs.loading}>
				{#if openPrs.loading}
					<section class="flex min-w-0 flex-col">
						<div class="group-head h-[27px]" aria-hidden="true">
							<Skeleton class="size-3.5" /><Skeleton class="h-3 w-36" />
						</div>
						<PrSkeletonRows count={3} />
					</section>
				{:else}
					{#each listedGroups as group (group.repo.id)}
						<section class="flex min-w-0 flex-col" aria-label="Pull requests in {group.repo.name}">
							<Typography.H2 class="group-head">
								<ProviderMark provider={group.repo.provider} size={14} />
								<span class="truncate font-mono">{group.repo.name}</span>
								{#if !group.loading}<span class="font-mono text-fg-ghost">{group.prs.length}</span>{/if}
							</Typography.H2>
							{#if group.loading}
								<PrSkeletonRows count={2} />
							{:else if group.error}
								<Alert.Root variant="error">
									<Alert.Title>Could not load pull requests</Alert.Title>
									<Alert.Description>{group.error}</Alert.Description>
									<Button variant="outline" class="mt-2 w-fit" onclick={() => void openPrs.loadRepo(group.repo)}
										>Retry</Button
									>
								</Alert.Root>
							{:else}
								<div class="pr-list" {@attach hoverHighlight({ items: '.pr-row', class: 'hl-row' })}>
									{#each group.prs as pr (pr.number)}
										{@const key = prKey(group.repo.id, pr.number)}
										{@const review = latest.get(key)}
										<div class="contents">
											<PrRow
												{pr}
												{review}
												progress={review ? recentSessions.summaries[review.id] : undefined}
												starting={starting === key}
												highlighted={previewRepoId === group.repo.id && preview?.pr.number === pr.number}
												disabled={!!starting && starting !== key}
												onOpen={() => openRow(pr, group.repo)}
												onReview={() => void start(pr, group.repo)}
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

					{#if query !== '' && matchTotal === 0 && !anyLoading && !showFetch}
						<p class="px-1 text-[13px] text-fg-faint">No open pull requests match “{filter.trim()}”.</p>
					{/if}
				{/if}
			</div>
		</div>
	{/if}
</ScrollArea>
