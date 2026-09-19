<script lang="ts">
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import Check from '@lucide/svelte/icons/check';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import FolderGit2 from '@lucide/svelte/icons/folder-git-2';
	import GitPullRequest from '@lucide/svelte/icons/git-pull-request';
	import Link2 from '@lucide/svelte/icons/link-2';
	import Plus from '@lucide/svelte/icons/plus';
	import RefreshCw from '@lucide/svelte/icons/refresh-cw';
	import Search from '@lucide/svelte/icons/search';
	import X from '@lucide/svelte/icons/x';
	import * as Alert from '@sivir-ui/svelte/components/alert';
	import { Badge } from '@sivir-ui/svelte/components/badge';
	import { Button, type ButtonStatus } from '@sivir-ui/svelte/components/button';
	import * as Card from '@sivir-ui/svelte/components/card';
	import * as ContextMenu from '@sivir-ui/svelte/components/context-menu';
	import { Input } from '@sivir-ui/svelte/components/input';
	import * as Modal from '@sivir-ui/svelte/components/modal';
	import { ScrollArea } from '@sivir-ui/svelte/components/scroll-area';
	import * as Sheet from '@sivir-ui/svelte/components/sheet';
	import { Skeleton } from '@sivir-ui/svelte/components/skeleton';
	import { Spinner } from '@sivir-ui/svelte/components/spinner';
	import { Switch } from '@sivir-ui/svelte/components/switch';
	import * as Typography from '@sivir-ui/svelte/components/typography';
	import type { Provider, ProviderAuth, PullPreview, PullRequest, RemoteRepo, Repo, Review } from '@recoder/shared';
	import { serverApi } from '$lib/server-api';
	import { modelSettingsUi } from '$lib/model-settings.svelte';
	import { sessionState } from '$lib/session-state.svelte';
	import { recentSessions } from '$lib/recent-sessions.svelte';

	const hoursAgoIso = (h: number): string => new Date(Date.now() - h * 3_600_000).toISOString();

	const DEMO_REPOS: Repo[] = [
		{ id: 'sivir-ui', name: 'aidan-neel/sivir-ui', url: 'https://github.com/aidan-neel/sivir-ui', provider: 'github', defaultBranch: 'main', createdAt: '', updatedAt: '' },
		{ id: 'recoder', name: 'aidan-neel/recoder', url: 'https://github.com/aidan-neel/recoder', provider: 'github', defaultBranch: 'main', createdAt: '', updatedAt: '' },
		{ id: 'skills', name: 'aidan-neel/skills', url: 'https://github.com/aidan-neel/skills', provider: 'github', defaultBranch: 'main', createdAt: '', updatedAt: '' }
	];

	const DEMO_AUTH: (ProviderAuth & { label: string })[] = [
		{ provider: 'github', label: 'GitHub', available: true, authenticated: true, user: 'aidan-neel' },
		{ provider: 'gitlab', label: 'GitLab', available: false, authenticated: false, user: null }
	];

	const DEMO_PRS: Record<string, PullRequest[]> = {
		'sivir-ui': [
			{ number: 160, title: 'refactor(cli): extract sivir list formatting, add sivir status', url: 'https://github.com/aidan-neel/sivir-ui/pull/160', author: 'aidan-neel', base: 'main', headRef: 'claude/reviewer-fixture-sol', headSha: 'demo', additions: 205, deletions: 22, changedFiles: 5, createdAt: hoursAgoIso(72) },
			{ number: 158, title: 'feat(theme): per-mode foundation colors in Theme Studio', url: 'https://github.com/aidan-neel/sivir-ui/pull/158', author: 'aidan-neel', base: 'main', headRef: 'theme/foundation', headSha: 'demo', additions: 604, deletions: 137, changedFiles: 12, createdAt: hoursAgoIso(5) },
			{ number: 155, title: 'fix(select): restore focus after outside click', url: 'https://github.com/aidan-neel/sivir-ui/pull/155', author: 'aidan-neel', base: 'main', headRef: 'fix/select-focus', headSha: 'demo', additions: 41, deletions: 18, changedFiles: 3, createdAt: hoursAgoIso(24) }
		],
		recoder: [
			{ number: 88, title: 'Add adaptive review planning', url: 'https://github.com/aidan-neel/recoder/pull/88', author: 'aidan-neel', base: 'main', headRef: 'adaptive-review', headSha: 'demo', additions: 312, deletions: 96, changedFiles: 9, createdAt: hoursAgoIso(50) }
		],
		skills: []
	};

	// TODO: remove after browse-UI testing — 40 mock repos for the remote list.
	const USE_MOCK_BROWSE = false;
	const MOCK_PROJECTS = [
		'ledger-api', 'gateway', 'console', 'billing', 'auth-service', 'search',
		'notifications', 'webhooks', 'audit-log', 'feature-flags', 'rate-limiter',
		'cache-layer', 'email-service', 'pdf-export', 'data-pipeline', 'ml-ranker',
		'geo-service', 'payments', 'invoicing', 'sso', 'cli', 'docs-site',
		'status-page', 'migrations', 'secrets-vault', 'queue-worker', 'image-proxy',
		'sitemap-gen', 'ab-testing', 'onboarding', 'permissions', 'api-gateway',
		'event-bus', 'tracing', 'backups', 'changelog', 'sdk-js', 'sdk-py',
		'terraform', 'helm-charts'
	];
	const MOCK_REMOTE: RemoteRepo[] = MOCK_PROJECTS.map((name, i) => ({
		name: `acme/${name}`,
		url: `https://${i % 5 === 4 ? 'gitlab.com' : 'github.com'}/acme/${name}`,
		provider: i % 5 === 4 ? 'gitlab' : 'github',
		isPrivate: i % 3 === 0
	}));

	const PROVIDERS: { id: Provider; label: string }[] = [
		{ id: 'github', label: 'GitHub' },
		{ id: 'gitlab', label: 'GitLab' }
	];

	let apiDown = $state(false);
	let repos = $state<Repo[]>([]);

	let auth = $state<{ github: ProviderAuth; gitlab: ProviderAuth } | null>(null);
	let authLoading = $state(true);
	let connecting = $state<Provider | null>(null);
	let connectOpen = $state(false);
	let tokenInput = $state('');
	let tokenSaving = $state(false);
	let tokenError = $state<string | null>(null);

	let browseOpen = $state(false);
	let repositoriesOpen = $state(false);
	let remote = $state<RemoteRepo[]>([]);
	let remoteQuery = $state('');
	let remoteLoading = $state(false);
	let remoteError = $state<string | null>(null);
	let trackingId = $state<string | null>(null);

	let filter = $state('');
	let prsByRepo = $state<Record<string, PullRequest[]>>({});
	let prsLoadingByRepo = $state<Record<string, boolean>>({});
	let prsErrorByRepo = $state<Record<string, string | null>>({});
	let refreshing = $state(false);
	let reviewTarget = $state<{ repoId: string; n: number; status: ButtonStatus } | null>(null);
	let preview = $state<PullPreview | null>(null);
	let previewRepoId = $state<string | null>(null);
	let fetchingPreview = $state(false);
	let prError = $state<string | null>(null);
	let interactiveReview = $state(false);

	/** Reviews require a reviewer model — no model, no (stub) review. */
	const needsModel = $derived(
		!apiDown && !!modelSettingsUi.config && !modelSettingsUi.config.configured
	);

	const trackedNames = $derived(new Set(repos.map((r) => r.url.replace(/\/$/, ''))));
	const providerRows = $derived<({ provider: Provider; label: string } & ProviderAuth)[]>(
		apiDown
			? DEMO_AUTH
			: auth
				? PROVIDERS.map(({ id, label }) => ({ ...auth![id], label }))
				: []
	);

	const pastedNumber = $derived(parsePrNumber(filter));
	const hasFilter = $derived(filter.trim() !== '');
	const anyPrsLoading = $derived(repos.some((r) => prsLoadingByRepo[r.id]));
	const matchTotal = $derived.by(() => {
		let n = 0;
		for (const repo of repos) n += sortedByRepo.get(repo.id)?.length ?? 0;
		return n;
	});
	/** Sidebar "selection" is just the search box narrowed to one repo name. */
	const activeRepo = $derived.by(() => {
		const q = filter.trim().toLowerCase();
		if (q === '') return null;
		return repos.find((r) => r.name.toLowerCase() === q) ?? null;
	});
	/** Per-repo filtered + sorted PR lists; groups render as labeled sections. */
	const sortedByRepo = $derived.by(() => {
		const q = filter.trim().toLowerCase();
		const fetched = preview;
		const map = new Map<string, PullRequest[]>();
		for (const repo of repos) {
			let list = prsByRepo[repo.id] ?? [];
			if (q !== '') {
				list = list.filter(
					(pr) =>
						(pr.number === pastedNumber && findRepoForPr(filter)?.id === repo.id && /https?:\/\//i.test(q)) ||
						repo.name.toLowerCase().includes(q) ||
						String(pr.number).includes(q) ||
						pr.title.toLowerCase().includes(q) ||
						pr.headRef.toLowerCase().includes(q) ||
						pr.base.toLowerCase().includes(q) ||
						pr.author.toLowerCase().includes(q)
				);
			}
			if (
				fetched &&
				previewRepoId === repo.id &&
				!list.some((p) => p.number === fetched.pr.number)
			) {
				list = [fetched.pr, ...list];
			}
			const sorted = [...list];
			sorted.sort((a, b) => {
				const ta = Date.parse(a.createdAt) || 0;
				const tb = Date.parse(b.createdAt) || 0;
				return tb - ta;
			});
			map.set(repo.id, sorted);
		}
		return map;
	});
	const showFetchCard = $derived(
		pastedNumber !== null &&
			repos.length > 0 &&
			!anyPrsLoading &&
			!(prsByRepo[findRepoForPr(filter)?.id ?? ''] ?? []).some((p) => p.number === pastedNumber) &&
			preview?.pr.number !== pastedNumber
	);
	const filteredRemote = $derived.by(() => {
		const q = remoteQuery.trim().toLowerCase();
		if (q === '') return remote;
		return remote.filter(
			(repo) =>
				repo.name.toLowerCase().includes(q) ||
				repo.provider.toLowerCase().includes(q) ||
				(repo.isPrivate && 'private'.includes(q))
		);
	});

	function timeAgo(iso: string): string {
		const t = Date.parse(iso);
		if (Number.isNaN(t)) return '';
		const s = Math.max(0, (Date.now() - t) / 1000);
		if (s < 60) return 'just now';
		const m = Math.floor(s / 60);
		if (m < 60) return m === 1 ? '1 minute ago' : `${m} minutes ago`;
		const h = Math.floor(m / 60);
		if (h < 24) return h === 1 ? '1 hour ago' : `${h} hours ago`;
		const d = Math.floor(h / 24);
		if (d === 1) return 'yesterday';
		if (d < 30) return `${d} days ago`;
		return new Date(t).toLocaleDateString();
	}

	function plural(n: number, word: string): string {
		return `${n} ${word}${n === 1 ? '' : 's'}`;
	}

	function parsePrNumber(text: string): number | null {
		const trimmed = text.trim();
		if (trimmed === '') return null;
		const url = trimmed.match(/(?:pull|merge_requests)\/(\d+)/i);
		const digits = (url?.[1] ?? (/^\d+$/.test(trimmed) ? trimmed : '')).replace(/\D/g, '');
		if (digits === '') return null;
		const n = Number.parseInt(digits, 10);
		return Number.isSafeInteger(n) && n > 0 ? n : null;
	}

	onMount(async () => {
		interactiveReview = localStorage.getItem('recoder.interactiveReview') === 'true';
		try {
			const [status, fetchedRepos] = await Promise.all([
				serverApi.authStatus(),
				serverApi.listRepos(),
				modelSettingsUi.load()
			]);
			auth = status;
			if (status.github.authenticated || status.gitlab.authenticated) void loadRemote();
			repos = fetchedRepos;
			await loadAllPrs();
		} catch {
			apiDown = true;
			repos = DEMO_REPOS;
			for (const repo of DEMO_REPOS) {
				prsByRepo[repo.id] = DEMO_PRS[repo.id] ?? [];
				prsLoadingByRepo[repo.id] = false;
			}
		} finally {
			authLoading = false;
		}
	});

	async function refreshAuth(): Promise<void> {
		try {
			auth = await serverApi.authStatus();
		} catch {
			// Keep last known state; the apiDown banner covers outages.
		}
	}

	function openConnect(provider: Provider): void {
		repositoriesOpen = false;
		connecting = provider;
		tokenInput = '';
		tokenError = null;
		connectOpen = true;
	}

	async function saveToken(provider: Provider): Promise<void> {
		if (!tokenInput.trim()) return;
		tokenSaving = true;
		tokenError = null;
		try {
			await serverApi.saveToken(provider, tokenInput.trim());
			tokenInput = '';
			connectOpen = false;
			connecting = null;
			await refreshAuth();
			await loadRemote();
		} catch (e) {
			tokenError = e instanceof Error ? e.message : 'Token rejected.';
		} finally {
			tokenSaving = false;
		}
	}

	async function disconnect(provider: Provider): Promise<void> {
		try {
			await serverApi.clearToken(provider);
		} finally {
			await refreshAuth();
			if (!auth || (!auth.github.authenticated && !auth.gitlab.authenticated)) {
				remote = [];
			}
		}
	}

	async function loadRemote(): Promise<void> {
		if (!auth) return;
		remoteLoading = true;
		remoteError = null;
		if (USE_MOCK_BROWSE) {
			await new Promise((r) => setTimeout(r, 500));
			remote = MOCK_REMOTE;
			remoteLoading = false;
			return;
		}
		try {
			const lists = await Promise.all(
				([] as Provider[])
					.concat(auth.github.authenticated ? ['github'] : [])
					.concat(auth.gitlab.authenticated ? ['gitlab'] : [])
					.map((p) => serverApi.remoteRepos(p))
			);
			remote = lists.flat();
		} catch (e) {
			remoteError = e instanceof Error ? e.message : 'Failed to list repositories.';
		} finally {
			remoteLoading = false;
		}
	}

	function openBrowse(): void {
		repositoriesOpen = false;
		browseOpen = true;
		remoteQuery = '';
		if (remote.length === 0 && !remoteLoading) void loadRemote();
	}

	async function trackRemote(repo: RemoteRepo): Promise<void> {
		trackingId = repo.url;
		try {
			const tracked = await serverApi.createRepo({
				name: repo.name,
				url: repo.url,
				provider: repo.provider
			});
			repos = [tracked, ...repos];
			void loadPrsForRepo(tracked);
		} catch (e) {
			remoteError = e instanceof Error ? e.message : 'Failed to track repo.';
		} finally {
			trackingId = null;
		}
	}

	function openSession(id: string, name: string, ref: string, status: 'reviewing' | 'ready'): void {
		sessionState.ensureSession(id, name, ref, status);
		void goto(`/session/${id}${interactiveReview ? '?view=diff' : ''}`);
	}

	function openReviewSession(review: Review, name: string): void {
		const status = review.status === 'running' || review.status === 'queued' ? 'reviewing' : 'ready';
		openSession(review.id, name, `#${review.prNumber}`, status);
	}

	function handleCardOpen(
		pr: PullRequest,
		repo: Pick<Repo, 'id' | 'name'>
	): void {
		if (reviewTarget) return;
		void reviewPr(pr.number, repo);
	}

	function copyPrLink(pr: PullRequest): void {
		void navigator.clipboard?.writeText(pr.url).catch(() => {});
	}

	/** Clicking a repo in the sidebar narrows the list to it via the search box; click again clears. */
	function toggleRepoFilter(name: string): void {
		repositoriesOpen = false;
		const active = filter.trim().toLowerCase() === name.toLowerCase();
		filter = active ? '' : name;
		preview = null;
		previewRepoId = null;
		prError = null;
	}

	async function loadPrsForRepo(repo: Repo, quiet = false): Promise<void> {
		if (!quiet) prsLoadingByRepo[repo.id] = true;
		prsErrorByRepo[repo.id] = null;
		if (apiDown) {
			if (!quiet) await new Promise((r) => setTimeout(r, 400));
			prsByRepo[repo.id] = DEMO_PRS[repo.id] ?? [];
			prsLoadingByRepo[repo.id] = false;
			return;
		}
		try {
			prsByRepo[repo.id] = await serverApi.listPrs(repo.id);
		} catch (e) {
			prsByRepo[repo.id] = [];
			prsErrorByRepo[repo.id] =
				e instanceof Error ? e.message : 'Failed to list pull requests.';
		} finally {
			prsLoadingByRepo[repo.id] = false;
		}
	}

	async function loadAllPrs(quiet = false): Promise<void> {
		await Promise.all(repos.map((repo) => loadPrsForRepo(repo, quiet)));
	}

	async function refreshReviews(): Promise<void> {
		if (apiDown) return;
		await recentSessions.refresh();
	}

	async function refreshAll(): Promise<void> {
		if (refreshing || repos.length === 0) return;
		refreshing = true;
		try {
			await Promise.all([loadAllPrs(true), refreshReviews()]);
		} finally {
			refreshing = false;
		}
	}

	/** Pick the tracked repo a pasted PR belongs to (URL match), else the first tracked. */
	function findRepoForPr(text: string): Repo | undefined {
		const url = text.match(/(?:github|gitlab)\.com\/([^/\s]+)\/([^/\s#?]+)/i);
		if (url) {
			const slug = `${url[1]}/${url[2]}`.toLowerCase();
			return (
				repos.find((r) => r.name.toLowerCase() === slug) ??
				repos.find((r) => r.url.toLowerCase().includes(slug))
			);
		}
		return repos[0];
	}

	async function fetchPreview(n: number): Promise<void> {
		const repo = findRepoForPr(filter);
		if (!repo || fetchingPreview) return;
		fetchingPreview = true;
		prError = null;
		preview = null;
		previewRepoId = repo.id;
		if (apiDown) {
			await new Promise((r) => setTimeout(r, 600));
			preview = {
				provider: repo.provider,
				pr: {
					number: n,
					title: `PR #${n}`,
					url: repo.url,
					author: 'unknown',
					base: repo.defaultBranch,
					headRef: 'unknown',
					headSha: 'unknown',
					additions: 0,
					deletions: 0,
					changedFiles: 0,
					createdAt: ''
				},
				files: []
			};
			fetchingPreview = false;
			return;
		}
		try {
			preview = await serverApi.previewPr(repo.id, n);
		} catch (e) {
			prError = e instanceof Error ? e.message : 'Failed to fetch PR.';
		} finally {
			fetchingPreview = false;
		}
	}

	async function reviewPr(n: number, repo: Pick<Repo, 'id' | 'name'>): Promise<void> {
		if (!repo || reviewTarget) return;
		reviewTarget = { repoId: repo.id, n, status: 'loading' };
		prError = null;
		if (apiDown) {
			prError = 'Connect to the review server to open a session.';
			reviewTarget = null;
			return;
		}
		try {
			const pr = prsByRepo[repo.id]?.find((item) => item.number === n) ?? (previewRepoId === repo.id && preview?.pr.number === n ? preview.pr : undefined);
			localStorage.setItem('recoder.interactiveReview', String(interactiveReview));
			const review = await serverApi.queueReview({ repoId: repo.id, prNumber: n, start: interactiveReview, prTitle: pr?.title });
			if (pr?.headRef) recentSessions.branches[`${repo.id}#${n}`] = pr.headRef;
			void refreshReviews();
			reviewTarget = { repoId: repo.id, n, status: 'success' };
			await new Promise((r) => setTimeout(r, 350));
			openReviewSession(review, repo.name);
		} catch (e) {
			reviewTarget = null;
			prError = e instanceof Error ? e.message : 'Could not open a review session.';
		}
	}
</script>

{#snippet providerMark(provider: Provider, size = 14)}
	{#if provider === 'github'}
		<svg
			width={size}
			height={size}
			viewBox="0 0 24 24"
			fill="currentColor"
			role="img"
			aria-label="GitHub"
			class="inline-block shrink-0 align-[-0.125em]"
		>
			<path
				d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"
			/>
		</svg>
	{:else}
		<svg
			width={size}
			height={size}
			viewBox="0 0 24 24"
			fill="currentColor"
			role="img"
			aria-label="GitLab"
			class="inline-block shrink-0 align-[-0.125em]"
		>
			<path
				d="m23.6004 9.5927-.0337-.0862L20.3.9814a.851.851 0 0 0-.3362-.405.8748.8748 0 0 0-.9997.0539.8748.8748 0 0 0-.29.4399l-2.2055 6.748H7.5375l-2.2057-6.748a.8573.8573 0 0 0-.29-.4412.8748.8748 0 0 0-.9997-.0537.8585.8585 0 0 0-.3362.4049L.4332 9.5015l-.0325.0862a6.0657 6.0657 0 0 0 2.0119 7.0105l.0113.0087.03.0213 4.976 3.7264 2.462 1.8633 1.4995 1.1321a1.0085 1.0085 0 0 0 1.2197 0l1.4995-1.1321 2.4619-1.8633 5.006-3.7489.0125-.01a6.0682 6.0682 0 0 0 2.0094-7.003z"
			/>
		</svg>
	{/if}
{/snippet}

{#snippet filterInput()}
	<div class="home-filter-field [--size-control-md:42px] [--font-size-body:16px]">
		<Input
			placeholder="Filter open PRs, or paste a URL"
			aria-label="Filter open PRs, or paste a URL"
			class="border-transparent bg-transparent text-[16px] md:text-[16px]"
			bind:value={filter}
			disabled={repos.length === 0}
			oninput={() => {
				prError = null;
				preview = null;
				previewRepoId = null;
			}}
		>
			{#snippet leading()}
				<Search size={18} strokeWidth={1.5} />
			{/snippet}
		</Input>
	</div>
{/snippet}

{#snippet prCard(pr: PullRequest, repo: Pick<Repo, 'id' | 'name'>, featured: boolean)}
	{@const isHighlighted = previewRepoId === repo.id && preview?.pr.number === pr.number}
	{@const queueing = reviewTarget?.repoId === repo.id && reviewTarget?.n === pr.number}
	{@const title = pr.title === '' ? `PR #${pr.number}` : pr.title}
	<ContextMenu.Root>
		<Card.Root class="pr-card rounded-xl bg-transparent p-0 {isHighlighted ? 'border-primary' : ''}">
		<ContextMenu.Trigger
			{...{
				onclick: () => handleCardOpen(pr, repo),
				onkeydowncapture: (event: KeyboardEvent) => {
					if (event.key === 'Enter' || event.key === ' ') {
						event.preventDefault();
						handleCardOpen(pr, repo);
					}
				},
				onpointerupcapture: (event: PointerEvent) => {
					if (event.pointerType === 'touch') event.stopPropagation();
				},
				'aria-busy': queueing,
				'aria-label': `Start a new review of ${title}, PR #${pr.number} in ${repo.name}`
			}}
			class="review-row flex min-w-0 cursor-pointer items-center gap-4 rounded-xl px-4 py-5 text-left transition-colors hover:bg-secondary/50"
		>
			<span class="flex min-w-0 flex-1 flex-col gap-2">
			<span class="flex min-w-0 items-center gap-2.5">
				<GitPullRequest size={20} strokeWidth={1.5} class="mr-1 shrink-0 text-success" aria-hidden="true" />
				<span class="min-w-0 text-[16px] leading-5 font-normal text-foreground max-sm:line-clamp-3 max-sm:break-words sm:truncate" title={title}>
					{title}
				</span>
				<Typography.Metadata class="shrink-0 font-mono text-[13px]">
					#{pr.number}
				</Typography.Metadata>
			</span>
			{#if featured}
				<Typography.Metadata class="flex flex-wrap gap-x-3 font-mono text-[12px]">
					{#if pr.createdAt}<span>{timeAgo(pr.createdAt)}</span>{/if}
					<span>{pr.author}</span>
				</Typography.Metadata>
			{/if}
			<span
				class="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2 font-mono text-[14px] text-foreground-muted"
			>
					<Typography.InlineCode class="max-w-full truncate rounded-md px-2 py-0.5 text-[14px] leading-5 font-normal text-foreground-muted" title={pr.headRef}>{pr.headRef}</Typography.InlineCode>
					<span>into</span>
					<Typography.InlineCode class="max-w-full truncate rounded-md px-2 py-0.5 text-[14px] leading-5 font-normal text-foreground-muted" title={pr.base}>{pr.base}</Typography.InlineCode>
					<span class="ml-3 whitespace-nowrap">{plural(pr.changedFiles, 'file')}</span>
					<span class="text-success">+{pr.additions}</span>
					<span class="text-error">-{pr.deletions}</span>
					{#if !featured}
					<span class="ml-3 flex min-w-0 flex-wrap items-center gap-x-6 gap-y-1">
						<span class="max-w-full truncate">{pr.author}</span>
						{#if pr.createdAt !== ''}
							<span>{timeAgo(pr.createdAt)}</span>
						{/if}
					</span>
					{/if}
				</span>
			</span>
			{#if queueing}
				<Spinner size={16} aria-hidden="true" />
			{:else}
				<ChevronRight size={20} strokeWidth={1.5} class="shrink-0 text-foreground-muted sm:mr-5" aria-hidden="true" />
			{/if}
		</ContextMenu.Trigger>
		</Card.Root>
		<ContextMenu.Content class="min-w-[13rem]">
			<ContextMenu.Item callback={() => void reviewPr(pr.number, repo)}>
				<span class="flex items-center gap-2"><GitPullRequest size={14} /> Start a new review</span>
			</ContextMenu.Item>
			<ContextMenu.Item callback={() => copyPrLink(pr)}>
				<span class="flex items-center gap-2"><Link2 size={14} /> Copy link</span>
			</ContextMenu.Item>
		</ContextMenu.Content>
	</ContextMenu.Root>
{/snippet}

{#snippet repositories(mobile = false)}
			<ScrollArea class="min-h-0 flex-1" showCues={false}>
			<div class="flex flex-col gap-1 px-4 py-3">
				<div class="mb-2 flex items-center justify-between gap-2">
					<Typography.H2 class="text-[14px] font-normal tracking-normal text-foreground-muted">Repositories</Typography.H2>
					{#if mobile}
						<Sheet.Close variant="ghost" size="icon" class="size-9" aria-label="Close repositories"><X size={16} /></Sheet.Close>
					{/if}
				</div>
				{#if authLoading}
					{#each [0, 1, 2] as i (i)}
						<Skeleton class="h-9 w-full rounded-md" />
					{/each}
				{:else if repos.length > 0}
					<nav class="-mx-2 flex flex-col" aria-label="Tracked repositories">
						{#each repos as repo (repo.id)}
							<Button
								unstyled
								type="button"
								aria-current={activeRepo?.id === repo.id ? 'true' : undefined}
								onclick={() => toggleRepoFilter(repo.name)}
								class="flex h-9 w-full items-center gap-2.5 rounded-md px-2 text-left transition-colors {activeRepo?.id ===
								repo.id
									? 'bg-secondary text-foreground'
									: 'text-foreground hover:bg-secondary/50'}"
							>
								<span class="flex shrink-0 items-center text-foreground">
									{@render providerMark(repo.provider, 16)}
								</span>
								<span class="truncate text-[14px] font-normal">{repo.name}</span>
							</Button>
						{/each}
					</nav>
				{:else}
					<p class="px-2 py-2 text-[14px] text-foreground-muted">No repositories tracked.</p>
				{/if}
				<Button
					variant="quiet"
					class="-mx-2 justify-start px-2 font-sans font-normal text-foreground-muted hover:text-foreground"
					onclick={openBrowse}
				>
					<Plus size={15} /> Track a repository
				</Button>
			</div>

		</ScrollArea>

		<div class="flex shrink-0 flex-col gap-1 p-3" aria-label="Providers">
			{#if authLoading}
				{#each [0, 1] as i (i)}
					<div class="flex items-center gap-2" role="status" aria-label="Loading providers">
						<Skeleton class="size-1.5 shrink-0 rounded-full" />
						<Skeleton class="h-4 w-16 rounded-md" />
					</div>
				{/each}
			{:else}
				{#each providerRows as provider (provider.provider)}
					<div class="flex items-center gap-2 px-1 py-0.5 text-[13px]">
						{#if provider.authenticated}
							<span class="h-1.5 w-1.5 shrink-0 rounded-full bg-success" aria-hidden="true"></span>
						{:else}
							<span class="h-1.5 w-1.5 shrink-0 rounded-full bg-foreground-muted/40"></span>
						{/if}
						<span class="flex shrink-0 items-center text-foreground">
							{@render providerMark(provider.provider, 14)}
						</span>
						{#if provider.authenticated && provider.user}
							<span class="truncate font-mono text-foreground-muted" title="Connected to {provider.label}">{provider.user}</span>
						{:else if !provider.available}
							<span class="truncate text-foreground-muted">CLI not installed</span>
						{:else}
							<span class="truncate text-foreground-muted">Not connected</span>
						{/if}
						<span class="ml-auto shrink-0">
							{#if provider.authenticated}
								<Button
									variant="quiet"
									class="px-2 text-[14px] font-normal text-foreground-muted hover:bg-secondary"
									onclick={() => void disconnect(provider.provider)}
								>
									Disconnect
								</Button>
							{:else if provider.available}
								<Button
									variant="quiet"
									class="px-2 text-[14px] text-info-vivid hover:bg-secondary"
									onclick={() => openConnect(provider.provider)}
								>
									Connect
								</Button>
							{/if}
						</span>
					</div>
				{/each}
			{/if}
		</div>
{/snippet}

<div class="flex h-full min-h-0 overflow-hidden">
	<aside aria-label="Repositories" class="hidden w-[340px] shrink-0 flex-col border-r border-border-subtle min-[1440px]:flex">
		{@render repositories()}
	</aside>

	<!-- Main -->
	<div class="flex min-h-0 min-w-0 flex-1 flex-col">
		<section class="flex min-h-0 min-w-0 flex-1 flex-col" aria-label="Home">
			<ScrollArea class="min-h-0 flex-1" aria-label="Open pull requests" showCues={false}>
				<div class="mx-auto flex w-full max-w-[1022px] flex-col gap-6 px-4 pt-6 pb-10 sm:px-6 sm:pt-14">
					<div class="flex items-center justify-between gap-3">
						<Typography.H1 class="text-[24px] font-normal leading-8 tracking-normal">Home</Typography.H1>
						<Sheet.Root bind:open={repositoriesOpen}>
							<Sheet.Trigger variant="outline" class="min-[1440px]:hidden"><FolderGit2 size={16} /> Repositories</Sheet.Trigger>
							<Sheet.Content side="left" class="w-[340px] max-w-[calc(100%-1rem)] [&>[data-ui=sheet-surface]]:gap-0 [&>[data-ui=sheet-surface]]:p-0">
								<Sheet.Title class="sr-only">Manage repositories</Sheet.Title>
								{@render repositories(true)}
							</Sheet.Content>
						</Sheet.Root>
					</div>

					<div class="flex items-center gap-2">
						{#if authLoading}
							<div class="min-w-0 flex-1">
								<Skeleton class="h-[var(--size-control-md)] w-full rounded-lg" />
							</div>
							<Skeleton class="size-[var(--size-control-md)] shrink-0 rounded-lg" />
						{:else}
							<div class="min-w-0 flex-1">{@render filterInput()}</div>
							<Button
								variant="outline"
								size="icon"
								class="size-[42px] shrink-0 bg-card text-foreground-muted"
								aria-busy={refreshing}
								disabled={refreshing || repos.length === 0}
								aria-label="Refresh pull requests"
								onclick={() => void refreshAll()}
							>
								{#if refreshing}<Spinner size={18} />{:else}<RefreshCw size={18} strokeWidth={1.5} />{/if}
							</Button>
						{/if}
					</div>

					<Switch bind:switched={interactiveReview} label="Interactive review" description="Start reviewing with the diff open. Select code and ask questions as the review runs." />

					{#if apiDown}
						<Alert.Root variant="warning">
							<Alert.Title>API unreachable</Alert.Title>
							<Alert.Description>
								Showing demo data. Start the server with <code class="font-mono">bun run dev:server</code>
								for live fetching.
							</Alert.Description>
						</Alert.Root>
					{:else if needsModel}
						<Alert.Root variant="warning">
							<Alert.Title>No reviewer model configured</Alert.Title>
							<Alert.Description>
								Reviews need at least one model — without it there is nothing to review with.
							</Alert.Description>
							<Button
								variant="outline"
								class="mt-2 w-fit font-sans"
								onclick={() => modelSettingsUi.show()}
							>
								Open reviewer models
							</Button>
						</Alert.Root>
					{/if}

					{#if prError}
						<p class="text-[13px] font-medium text-error" role="alert">{prError}</p>
					{/if}

					{#if showFetchCard && pastedNumber !== null}
						<div class="flex min-w-0 items-center gap-3 px-2 py-1">
							<p class="min-w-0 flex-1 truncate font-mono text-[13px] text-foreground-muted">
								PR #{pastedNumber} isn’t in the open list.
							</p>
							<Button
								variant="quiet"
								class="shrink-0 font-sans text-info-vivid"
								loading={fetchingPreview}
								onclick={() => void fetchPreview(pastedNumber)}
							>
								Fetch
							</Button>
						</div>
					{/if}

					<div class="flex flex-col gap-7" aria-busy={anyPrsLoading}>
						{#each repos as repo (repo.id)}
							{@const groupPrs = sortedByRepo.get(repo.id) ?? []}
							{#if !hasFilter || groupPrs.length > 0 || activeRepo?.id === repo.id}
								<section
									class="flex min-w-0 flex-col gap-4"
									aria-label="Pull requests in {repo.name}"
								>
									<div class="mb-2 flex items-center gap-2 text-foreground-muted">
										<span class="flex shrink-0 items-center">
											{@render providerMark(repo.provider, 16)}
										</span>
										<Typography.H2 class="min-w-0 truncate font-mono text-[14px] leading-5 font-normal tracking-normal text-foreground-muted">
											{repo.name}
										</Typography.H2>
										<Typography.Metadata class="ml-4 text-[14px] tabular-nums">{groupPrs.length}</Typography.Metadata>
									</div>
									{#if prsLoadingByRepo[repo.id]}
										<div role="status" aria-label="Loading pull requests" class="flex min-w-0 items-start gap-3 px-2 py-3">
											<Skeleton class="mt-0.5 size-[18px] shrink-0 rounded-full" />
											<div class="min-w-0 flex-1">
												<Skeleton class="h-5 w-2/3" />
												<Skeleton class="mt-1.5 h-4 w-1/2" />
											</div>
											<Skeleton class="size-[18px] shrink-0 rounded-md" />
										</div>
									{:else if prsErrorByRepo[repo.id]}
										<Alert.Root variant="error">
											<Alert.Title>Could not load pull requests</Alert.Title>
											<Alert.Description>{prsErrorByRepo[repo.id]}</Alert.Description>
											<Button
												variant="outline"
												class="mt-2 w-fit font-sans"
												onclick={() => void loadPrsForRepo(repo)}
											>
												Retry
											</Button>
										</Alert.Root>
									{:else if groupPrs.length === 0}
										<p class="px-1 py-3 text-[14px] text-foreground-muted">
											No open pull requests.
										</p>
									{:else}
										{#each groupPrs as pr (pr.number)}
												{@render prCard(pr, repo, groupPrs.length === 1)}
										{/each}
									{/if}
								</section>
							{/if}
						{/each}
						{#if authLoading}
							<Skeleton class="h-[120px] w-full rounded-xl" />
						{:else if repos.length === 0}
							<Typography.Text variant="supporting" class="px-1 py-3">
								Track a repository to see its open pull requests.
							</Typography.Text>
							<Button variant="outline" class="w-fit" onclick={openBrowse}><Plus size={16} /> Add repository</Button>
						{:else if hasFilter && !activeRepo && pastedNumber === null && matchTotal === 0 && !anyPrsLoading}
							<p class="px-1 py-3 text-[14px] text-foreground-muted">
								No pull requests match this filter.
							</p>
						{/if}
					</div>
				</div>
			</ScrollArea>
		</section>
	</div>
</div>

<Modal.Root bind:open={browseOpen}>
	<Modal.Content size="lg">
		<Modal.Header>
			<Modal.Title>Your repositories</Modal.Title>
		</Modal.Header>
		<Modal.Body>
			{#if remoteLoading}
				<div class="flex flex-col gap-2" role="status" aria-label="Listing repositories">
					{#each [0, 1, 2, 3] as i (i)}
						<Skeleton class="h-11 w-full rounded-lg" />
					{/each}
				</div>
			{:else if remoteError}
				<Alert.Root variant="error">
					<Alert.Title>Could not list repositories</Alert.Title>
					<Alert.Description>{remoteError}</Alert.Description>
					<Button variant="outline" class="mt-2 w-fit font-sans" onclick={() => void loadRemote()}>
						Retry
					</Button>
				</Alert.Root>
			{:else if remote.length === 0}
				<p class="m-0 text-[14px] text-foreground-muted">
					Connect {@render providerMark('github', 14)} or {@render providerMark('gitlab', 14)} to browse your repositories.
				</p>
			{:else}
				<div class="flex flex-col gap-3">
					<Input
						variant="secondary"
						placeholder="Search repositories"
						aria-label="Search repositories"
						bind:value={remoteQuery}
					>
						{#snippet leading()}
							<Search size={15} />
						{/snippet}
					</Input>
					{#if filteredRemote.length === 0}
						<p class="m-0 px-1 py-3 text-[14px] text-foreground-muted">
							No repositories match “{remoteQuery.trim()}”.
						</p>
					{:else}
						<ScrollArea aria-label="Your repositories" class="max-h-[60dvh]" showCues={false}>
							<ul class="m-0 flex list-none flex-col divide-y divide-border p-0">
								{#each filteredRemote as repo (repo.url)}
									{@const tracked = trackedNames.has(repo.url.replace(/\/$/, ''))}
									<li class="flex items-center gap-3 py-2">
										<span class="min-w-0 flex-1 truncate font-mono text-[14px]">{repo.name}</span>
										<span class="flex shrink-0 items-center gap-1.5">
											<Badge variant="secondary" aria-label={repo.provider === 'github' ? 'GitHub' : 'GitLab'}>
												{@render providerMark(repo.provider, 13)}
											</Badge>
											{#if repo.isPrivate}
												<Badge variant="secondary">private</Badge>
											{/if}
										</span>
										{#if tracked}
											<Button
												variant="outline"
												size="icon"
												disabled
												class="size-9 shrink-0 cursor-default text-success disabled:opacity-100"
												aria-label="{repo.name} is already tracked"
											>
												<Check size={15} aria-hidden="true" />
											</Button>
										{:else}
											<Button
												variant="outline"
												size="icon"
												class="size-9 shrink-0"
												disabled={trackingId === repo.url}
												aria-label="Track {repo.name}"
												onclick={() => void trackRemote(repo)}
											>
												{#if trackingId === repo.url}
													<Spinner size={15} aria-hidden="true" />
												{:else}
													<Plus size={15} aria-hidden="true" />
												{/if}
											</Button>
										{/if}
									</li>
								{/each}
							</ul>
						</ScrollArea>
					{/if}
				</div>
			{/if}
		</Modal.Body>
	</Modal.Content>
</Modal.Root>

<Modal.Root bind:open={connectOpen}>
	<Modal.Content size="sm">
		<Modal.Header>
			<Modal.Title>
				<span class="inline-flex items-center gap-2">
					Connect
					{#if connecting}
						{@render providerMark(connecting, 16)}
					{/if}
				</span>
			</Modal.Title>
		</Modal.Header>
		<Modal.Body>
			<form
				id="connect-provider"
				class="grid gap-3"
				onsubmit={(e) => {
					e.preventDefault();
					if (connecting) void saveToken(connecting);
				}}
			>
				<Input
					type="password"
					label="Personal access token"
					autocomplete="off"
					placeholder={connecting === 'gitlab' ? 'glpat-…' : 'ghp_… / github_pat_…'}
					bind:value={tokenInput}
				/>
				<p class="m-0 text-[13px] text-foreground-muted">
					{connecting === 'gitlab'
						? 'Needs read_api + read_repository. Stored in server memory only.'
						: 'Needs repo scope. Stored in server memory only.'}
				</p>
				{#if tokenError}
					<p class="m-0 text-[13px] font-medium text-error" role="alert">{tokenError}</p>
				{/if}
			</form>
		</Modal.Body>
		<Modal.Footer>
			<Modal.Close>Cancel</Modal.Close>
			<Button type="submit" form="connect-provider" loading={tokenSaving}>Save</Button>
		</Modal.Footer>
	</Modal.Content>
</Modal.Root>
