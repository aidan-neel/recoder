<script lang="ts">
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import ArrowUpRight from '@lucide/svelte/icons/arrow-up-right';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import GitPullRequest from '@lucide/svelte/icons/git-pull-request';
	import Hash from '@lucide/svelte/icons/hash';
	import Link2 from '@lucide/svelte/icons/link-2';
	import Moon from '@lucide/svelte/icons/moon';
	import Plus from '@lucide/svelte/icons/plus';
	import RefreshCw from '@lucide/svelte/icons/refresh-cw';
	import Search from '@lucide/svelte/icons/search';
	import Settings from '@lucide/svelte/icons/settings';
	import Sun from '@lucide/svelte/icons/sun';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import { Button, type ButtonStatus } from '@sivir-ui/svelte/components/button';
	import * as Alert from '@sivir-ui/svelte/components/alert';
	import * as AlertDialog from '@sivir-ui/svelte/components/alert-dialog';
	import * as Collapsible from '@sivir-ui/svelte/components/collapsible';
	import * as ContextMenu from '@sivir-ui/svelte/components/context-menu';
	import * as DropdownMenu from '@sivir-ui/svelte/components/dropdown-menu';
	import { Input } from '@sivir-ui/svelte/components/input';
	import * as Modal from '@sivir-ui/svelte/components/modal';
	import { ScrollArea } from '@sivir-ui/svelte/components/scroll-area';
	import Shortcut from '@sivir-ui/svelte/components/shortcut';
	import { Skeleton } from '@sivir-ui/svelte/components/skeleton';
	import type { Provider, ProviderAuth, PullPreview, PullRequest, RemoteRepo, Repo, Review } from '@recoder/shared';
	import { serverApi } from '$lib/server-api';
	import { modelSettingsUi } from '$lib/model-settings.svelte';
	import { sessionState } from '$lib/session-state.svelte';
	import { theme } from '$lib/theme.svelte';

	interface RecentSession {
		id: string;
		repo: string;
		pr: number;
		findings: number;
		status: 'passed' | 'running' | 'queued';
	}

	const DEMO_REPOS: Repo[] = [
		{ id: 'ledger-api', name: 'acme/ledger-api', url: 'https://github.com/acme/ledger-api', provider: 'github', defaultBranch: 'main', createdAt: '', updatedAt: '' },
		{ id: 'gateway', name: 'acme/gateway', url: 'https://github.com/acme/gateway', provider: 'github', defaultBranch: 'main', createdAt: '', updatedAt: '' },
		{ id: 'infra', name: 'infra/local', url: 'https://gitlab.com/infra/local', provider: 'gitlab', defaultBranch: 'main', createdAt: '', updatedAt: '' }
	];

	const DEMO_RECENT: RecentSession[] = [
		{ id: 'ledger-api', repo: 'ledger-api', pr: 4127, findings: 4, status: 'passed' },
		{ id: 'gateway', repo: 'gateway', pr: 902, findings: 0, status: 'running' },
		{ id: 'console', repo: 'console', pr: 3310, findings: 0, status: 'queued' }
	];

	const hoursAgoIso = (h: number): string => new Date(Date.now() - h * 3_600_000).toISOString();

	const DEMO_PRS: Record<string, PullRequest[]> = {
		'ledger-api': [
			{ number: 4127, title: 'Rate limit refactor', url: 'https://github.com/acme/ledger-api/pull/4127', author: 'dan', base: 'main', headRef: 'feat/rate-limit', headSha: 'demo', additions: 89, deletions: 34, changedFiles: 6, createdAt: hoursAgoIso(2) },
			{ number: 4119, title: 'Fix decimal rounding in ledger totals', url: 'https://github.com/acme/ledger-api/pull/4119', author: 'mira', base: 'main', headRef: 'fix/rounding', headSha: 'demo', additions: 41, deletions: 12, changedFiles: 3, createdAt: hoursAgoIso(26) },
			{ number: 4112, title: 'Bump bun to 1.3.11', url: 'https://github.com/acme/ledger-api/pull/4112', author: 'dan', base: 'main', headRef: 'chore/bun-1.3.11', headSha: 'demo', additions: 6, deletions: 6, changedFiles: 2, createdAt: hoursAgoIso(72) },
			{ number: 4098, title: 'Add webhook HMAC verification', url: 'https://github.com/acme/ledger-api/pull/4098', author: 'sasha', base: 'main', headRef: 'feat/webhook-hmac', headSha: 'demo', additions: 212, deletions: 58, changedFiles: 9, createdAt: hoursAgoIso(96) }
		],
		gateway: [
			{ number: 902, title: 'Retry with jitter on 503s', url: 'https://github.com/acme/gateway/pull/902', author: 'mira', base: 'main', headRef: 'feat/retry-jitter', headSha: 'demo', additions: 57, deletions: 11, changedFiles: 4, createdAt: hoursAgoIso(5) },
			{ number: 898, title: 'Drop idle upstream connections', url: 'https://github.com/acme/gateway/pull/898', author: 'dan', base: 'main', headRef: 'perf/idle-conns', headSha: 'demo', additions: 23, deletions: 19, changedFiles: 2, createdAt: hoursAgoIso(49) }
		],
		infra: [
			{ number: 12, title: 'Pin runner image digest', url: 'https://gitlab.com/infra/local/-/merge_requests/12', author: 'sasha', base: 'main', headRef: 'chore/pin-runner', headSha: 'demo', additions: 3, deletions: 3, changedFiles: 1, createdAt: hoursAgoIso(30) }
		]
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

	const statusDot = {
		passed: '#3fb96c',
		running: '#5b8cff',
		queued: '#8a8f98'
	} as const;

	let apiDown = $state(false);
	let repos = $state<Repo[]>([]);
	let recent = $state<RecentSession[]>([]);
	let recentLoading = $state(true);
	let allReviews = $state<Review[]>([]);

	let auth = $state<{ github: ProviderAuth; gitlab: ProviderAuth } | null>(null);
	let authLoading = $state(true);
	let connecting = $state<Provider | null>(null);
	let tokenInput = $state('');
	let tokenSaving = $state(false);
	let tokenError = $state<string | null>(null);

	let browseOpen = $state(false);
	let remote = $state<RemoteRepo[]>([]);
	let remoteLoading = $state(false);
	let remoteError = $state<string | null>(null);
	let trackingId = $state<string | null>(null);

	let selectedRepo = $state<string | null>(null);
	let filter = $state('');
	let prs = $state<PullRequest[]>([]);
	let prsLoading = $state(true);
	let prsError = $state<string | null>(null);
	let refreshing = $state(false);
	let reviewTarget = $state<{ n: number; status: ButtonStatus } | null>(null);
	let preview = $state<PullPreview | null>(null);
	let fetchingPreview = $state(false);
	let prError = $state<string | null>(null);
	/** Reviews require a reviewer model — no model, no (stub) review. */
	const needsModel = $derived(
		!apiDown && !!modelSettingsUi.config && !modelSettingsUi.config.configured
	);

	const selected = $derived(repos.find((r) => r.id === selectedRepo));
	const trackedNames = $derived(new Set(repos.map((r) => r.url.replace(/\/$/, ''))));
	const isConnected = $derived(
		apiDown || !!(auth && (auth.github.authenticated || auth.gitlab.authenticated))
	);
	const reviewed = $derived(
		new Set(
			allReviews
				.filter((r) => r.status === 'passed' || r.status === 'failed')
				.map((r) => `${r.repoId}#${r.prNumber}`)
		)
	);
	const filtered = $derived(
		prs.filter((pr) => {
			const q = filter.trim().toLowerCase();
			if (q === '') return true;
			return (
				String(pr.number).includes(q) ||
				pr.title.toLowerCase().includes(q) ||
				pr.headRef.toLowerCase().includes(q) ||
				pr.base.toLowerCase().includes(q) ||
				pr.author.toLowerCase().includes(q)
			);
		})
	);
	const pastedNumber = $derived(parsePrNumber(filter));
	const highlightN = $derived(preview?.pr.number ?? null);
	const showFetchCard = $derived(
		pastedNumber !== null &&
			!!selected &&
			!prs.some((p) => p.number === pastedNumber) &&
			preview?.pr.number !== pastedNumber
	);
	const displayPrs = $derived.by(() => {
		const fetched = preview;
		if (!fetched) return filtered;
		return prs.some((p) => p.number === fetched.pr.number)
			? filtered
			: [fetched.pr, ...filtered];
	});

	function mapRecent(reviews: Review[], names: Map<string, string>): RecentSession[] {
		return reviews.flatMap((review) => {
			if (review.status === 'failed') return [];
			return [
				{
					id: review.id,
					repo: names.get(review.repoId) ?? review.repoId.slice(0, 8),
					pr: review.prNumber,
					findings: review.findings.length,
					status: review.status
				}
			];
		});
	}

	function timeAgo(iso: string): string {
		const t = Date.parse(iso);
		if (Number.isNaN(t)) return '';
		const s = Math.max(0, (Date.now() - t) / 1000);
		if (s < 60) return 'just now';
		const m = Math.floor(s / 60);
		if (m < 60) return `${m}m ago`;
		const h = Math.floor(m / 60);
		if (h < 24) return `${h}h ago`;
		const d = Math.floor(h / 24);
		if (d === 1) return 'yesterday';
		if (d < 30) return `${d}d ago`;
		return new Date(t).toLocaleDateString();
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
		theme.ensureLoaded();
		try {
			const [status, fetchedRepos, reviews] = await Promise.all([
				serverApi.authStatus(),
				serverApi.listRepos(),
				serverApi.listReviews(),
				modelSettingsUi.load()
			]);
			auth = status;
			if (status.github.authenticated || status.gitlab.authenticated) void loadRemote();
			repos = fetchedRepos;
			allReviews = reviews;
			recent = mapRecent(reviews, new Map(fetchedRepos.map((r) => [r.id, r.name] as const)));
			if (!selectedRepo && fetchedRepos.length > 0) selectedRepo = fetchedRepos[0].id;
			await loadPrs();
		} catch {
			apiDown = true;
			repos = DEMO_REPOS;
			recent = DEMO_RECENT;
			if (!selectedRepo) selectedRepo = DEMO_REPOS[0].id;
			prs = DEMO_PRS[selectedRepo ?? ''] ?? [];
			prsLoading = false;
		} finally {
			authLoading = false;
			recentLoading = false;
		}
	});

	async function refreshAuth(): Promise<void> {
		try {
			auth = await serverApi.authStatus();
		} catch {
			// Keep last known state; the apiDown banner covers outages.
		}
	}

	async function saveToken(provider: Provider): Promise<void> {
		if (!tokenInput.trim()) return;
		tokenSaving = true;
		tokenError = null;
		try {
			await serverApi.saveToken(provider, tokenInput.trim());
			tokenInput = '';
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
		browseOpen = true;
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
			selectRepo(tracked.id);
		} catch (e) {
			remoteError = e instanceof Error ? e.message : 'Failed to track repo.';
		} finally {
			trackingId = null;
		}
	}

	function openSession(id: string, name: string, ref: string, status: 'reviewing' | 'ready'): void {
		sessionState.ensureSession(id, name, ref, status);
		void goto(`/session/${id}`);
	}

	function copySessionLink(id: string): void {
		const url = `${window.location.origin}/session/${id}`;
		void navigator.clipboard?.writeText(url).catch(() => {});
	}

	function copySessionId(id: string): void {
		void navigator.clipboard?.writeText(id).catch(() => {});
	}

	let deletingId = $state<string | null>(null);
	let pendingDeleteId = $state<string | null>(null);
	let deleteDialogOpen = $state(false);
	const pendingDelete = $derived(recent.find((s) => s.id === pendingDeleteId) ?? null);

	function confirmDelete(): void {
		const id = pendingDeleteId;
		pendingDeleteId = null;
		deleteDialogOpen = false;
		if (id) void deleteSession(id);
	}

	async function deleteSession(id: string): Promise<void> {
		if (deletingId) return;
		deletingId = id;
		try {
			if (!apiDown) await serverApi.deleteReview(id);
			allReviews = allReviews.filter((r) => r.id !== id);
			recent = recent.filter((s) => s.id !== id);
			// Drop the matching tab too, if one is open.
			sessionState.close(id);
		} catch (e) {
			prError = e instanceof Error ? e.message : 'Failed to delete session.';
		} finally {
			deletingId = null;
		}
	}

	function selectRepo(id: string): void {
		if (selectedRepo === id) return;
		selectedRepo = id;
		filter = '';
		preview = null;
		reviewTarget = null;
		prError = null;
		// Quiet reload: keep the current list mounted to avoid a skeleton flash.
		refreshing = true;
		void loadPrs(true).finally(() => {
			refreshing = false;
		});
	}

	async function loadPrs(quiet = false): Promise<void> {
		if (!selected) {
			prs = [];
			prsLoading = false;
			return;
		}
		if (!quiet) prsLoading = true;
		prsError = null;
		if (apiDown) {
			if (!quiet) await new Promise((r) => setTimeout(r, 400));
			prs = DEMO_PRS[selected.id] ?? [];
			prsLoading = false;
			return;
		}
		try {
			prs = await serverApi.listPrs(selected.id);
		} catch (e) {
			prs = [];
			prsError = e instanceof Error ? e.message : 'Failed to list pull requests.';
		} finally {
			prsLoading = false;
		}
	}

	async function refreshReviews(): Promise<void> {
		if (apiDown) return;
		try {
			const reviews = await serverApi.listReviews();
			allReviews = reviews;
			recent = mapRecent(reviews, new Map(repos.map((r) => [r.id, r.name] as const)));
		} catch {
			// Keep last known state; the list error surfaces fetch failures.
		}
	}

	async function refreshAll(): Promise<void> {
		if (refreshing || !selected) return;
		refreshing = true;
		try {
			await Promise.all([loadPrs(true), refreshReviews()]);
		} finally {
			refreshing = false;
		}
	}

	async function fetchPreview(n: number): Promise<void> {
		if (!selected || fetchingPreview) return;
		fetchingPreview = true;
		prError = null;
		preview = null;
		if (apiDown) {
			await new Promise((r) => setTimeout(r, 600));
			preview = {
				provider: selected.provider,
				pr: {
					number: n,
					title: `PR #${n}`,
					url: selected.url,
					author: 'unknown',
					base: selected.defaultBranch,
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
			preview = await serverApi.previewPr(selected.id, n);
		} catch (e) {
			prError = e instanceof Error ? e.message : 'Failed to fetch PR.';
		} finally {
			fetchingPreview = false;
		}
	}

	async function reviewPr(n: number): Promise<void> {
		if (!selected || reviewTarget) return;
		if (!apiDown && modelSettingsUi.config && !modelSettingsUi.config.configured) {
			prError = 'Add a reviewer model first — reviews cannot run without one.';
			modelSettingsUi.show();
			return;
		}
		reviewTarget = { n, status: 'loading' };
		prError = null;
		if (apiDown) {
			await new Promise((r) => setTimeout(r, 900));
			const session = sessionState.restartReview(selected.id, selected.name, `#${n}`);
			reviewTarget = { n, status: 'success' };
			await new Promise((r) => setTimeout(r, 350));
			await goto(`/session/${session.id}`);
			return;
		}
		try {
			const review = await serverApi.queueReview({ repoId: selected.id, prNumber: n });
			await refreshReviews();
			reviewTarget = { n, status: 'success' };
			await new Promise((r) => setTimeout(r, 350));
			openSession(review.id, selected.name, `#${n}`, 'reviewing');
		} catch (e) {
			reviewTarget = null;
			prError = e instanceof Error ? e.message : 'Failed to queue review.';
		}
	}
</script>

<div class="flex min-h-[calc(100vh-52px-4rem)] flex-col px-4 py-10">
	<!-- Top-anchored (mx-auto, not m-auto): vertically centering this column
		re-centers the whole page whenever async content changes its height,
		which reads as a full-page layout shift on every load. -->
	<div class="session-enter mx-auto w-full max-w-4xl">
	<div class="flex items-start justify-between gap-2">
		<div class="min-w-0">
			<h1 class="text-2xl font-semibold tracking-tight">Start a review</h1>
			<p class="mt-1 text-[15px] leading-relaxed text-foreground-muted">
				Pick an open pull request. Recoder fetches the diff and spins up reviewer subagents.
			</p>
		</div>
		<div class="flex shrink-0 items-center gap-1 pt-1">
			<Button
				variant="ghost"
				size="icon"
				aria-label={theme.dark ? 'Switch to light mode' : 'Switch to dark mode'}
				title={theme.dark ? 'Switch to light mode' : 'Switch to dark mode'}
				onclick={() => theme.toggle()}
			>
				{#if theme.dark}
					<Sun size={15} />
				{:else}
					<Moon size={15} />
				{/if}
			</Button>
			<Button
				variant="ghost"
				size="icon"
				aria-label="Reviewer model settings"
				title="Reviewer model settings"
				onclick={() => modelSettingsUi.show()}
			>
				<Settings size={15} />
			</Button>
		</div>
	</div>

	{#if apiDown}
		<Alert.Root variant="warning" class="session-enter mt-4">
			<Alert.Title>API unreachable</Alert.Title>
			<Alert.Description>
				Showing demo data. Start the server with <code class="font-mono">bun run dev:server</code>
				for live fetching.
			</Alert.Description>
		</Alert.Root>
	{:else if needsModel}
		<Alert.Root variant="warning" class="session-enter mt-4">
			<Alert.Title>No reviewer model configured</Alert.Title>
			<Alert.Description>
				Reviews need at least one model — without it there is nothing to review with.
			</Alert.Description>
			<Button
				variant="outline"
				size="sm"
				class="mt-2 w-fit font-sans"
				onclick={() => modelSettingsUi.show()}
			>
				Open reviewer models
			</Button>
		</Alert.Root>
	{/if}

	<div class="session-enter mt-8 flex flex-col gap-2 sm:flex-row" style="animation-delay: 80ms">
		{#if authLoading}
			<Skeleton class="h-[var(--size-control-md)] w-full rounded-lg sm:w-64 sm:shrink-0" />
		{:else if repos.length > 0}
			<DropdownMenu.Root>
				<DropdownMenu.Trigger
					variant="outline"
					aria-label="Select repository"
					class="h-[var(--size-control-md)] w-full justify-between font-mono text-[14px] sm:w-64 sm:shrink-0"
				>
					<span class="flex min-w-0 items-center gap-2.5">
						<span class="h-1.5 w-1.5 shrink-0 rounded-full bg-success"></span>
						<span class="truncate">{selected?.name ?? 'Select repository'}</span>
					</span>
					<ChevronDown size={15} class="shrink-0 text-foreground-muted" />
				</DropdownMenu.Trigger>
				<DropdownMenu.Content class="w-64">
					<DropdownMenu.RadioGroup
						value={selectedRepo ?? ''}
						onValueChange={(v) => selectRepo(v)}
					>
						{#each repos as repo (repo.id)}
							<DropdownMenu.RadioItem value={repo.id}>
								<span class="flex min-w-0 flex-1 items-center gap-2.5">
									<span class="h-1.5 w-1.5 shrink-0 rounded-full bg-success"></span>
									<span class="truncate font-mono text-[14px]">{repo.name}</span>
									<span class="ml-auto shrink-0 text-[12px] text-foreground-muted">
										{repo.provider}
									</span>
								</span>
							</DropdownMenu.RadioItem>
						{/each}
					</DropdownMenu.RadioGroup>
					<DropdownMenu.Separator />
					<DropdownMenu.Item callback={openBrowse}>
						<span class="flex items-center gap-2 font-sans">
							<Plus size={14} /> Add repository
						</span>
					</DropdownMenu.Item>
				</DropdownMenu.Content>
			</DropdownMenu.Root>
		{:else}
			<Button variant="outline" class="h-[var(--size-control-md)] shrink-0 font-sans" onclick={openBrowse}>
				<Plus size={15} /> Add repository
			</Button>
		{/if}
		<div class="relative min-w-0 flex-1">
			<Search
				size={15}
				class="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-foreground-muted"
			/>
			<Input
				placeholder="Filter open PRs, or paste a pull request URL"
				aria-label="Filter open PRs, or paste a pull request URL"
				bind:value={filter}
				disabled={!selected}
				class="pl-9"
				oninput={() => {
					prError = null;
					preview = null;
				}}
			/>
		</div>
		<Button
			variant="outline"
			class="h-[var(--size-control-md)] shrink-0 font-sans"
			loading={refreshing}
			disabled={!selected}
			onclick={() => void refreshAll()}
		>
			<RefreshCw size={15} /> Refresh
		</Button>
	</div>

	<div class="session-enter mt-8 flex items-baseline justify-between gap-2" style="animation-delay: 140ms">
		<h2 class="text-[15px] font-medium tabular-nums">
			Open pull requests · {prsLoading ? '…' : filtered.length}
		</h2>
	</div>

	{#if prError}
		<p class="mt-2 text-[13px] font-medium text-error" role="alert">{prError}</p>
	{/if}

	<div class="session-enter mt-3 grid gap-2.5" style="animation-delay: 180ms" aria-busy={prsLoading}>
		{#if prsLoading}
			{#each [0, 1, 2] as i (i)}
				<div
					class="flex min-w-0 items-center gap-3 rounded-xl border border-border bg-card px-4 py-3.5"
					role="status"
					aria-label="Loading pull requests"
				>
					<Skeleton class="mt-0.5 size-[18px] shrink-0 self-start rounded-full" />
					<div class="min-w-0 flex-1">
						<Skeleton class="h-[22px] w-2/3" />
						<Skeleton class="mt-0.5 h-5 w-1/2" />
					</div>
					<Skeleton class="hidden h-5 w-32 shrink-0 sm:block" />
					<Skeleton class="h-[34px] w-[84px] shrink-0 rounded-lg" />
				</div>
			{/each}
		{:else if prsError}
			<div class="flex min-w-0 items-center gap-3 rounded-xl border border-border bg-card px-4 py-3.5">
				<p class="min-w-0 flex-1 text-[14px] font-medium text-error">{prsError}</p>
				<Button variant="outline" size="sm" class="shrink-0 font-sans" onclick={() => void loadPrs()}>
					Retry
				</Button>
			</div>
		{:else}
			{#if showFetchCard && pastedNumber !== null}
				<div class="flex min-w-0 items-center gap-3 rounded-xl border border-dashed border-border px-4 py-3">
					<p class="min-w-0 flex-1 truncate font-mono text-[13px] text-foreground-muted">
						PR #{pastedNumber} isn’t in the open list.
					</p>
					<Button
						variant="outline"
						size="sm"
						class="shrink-0 font-sans"
						loading={fetchingPreview}
						onclick={() => void fetchPreview(pastedNumber)}
					>
						Fetch
					</Button>
				</div>
			{/if}
			{#each displayPrs as pr (pr.number)}
				{@const isHighlighted = highlightN === pr.number}
				{@const isReviewed = reviewed.has(`${selected?.id}#${pr.number}`)}
				<div
					class="flex min-w-0 items-center gap-3 rounded-xl border px-4 py-3.5 transition-colors {isHighlighted
						? 'border-primary/60 bg-primary/[0.05]'
						: 'border-border bg-card'}"
				>
					<GitPullRequest
						size={18}
						class="mt-0.5 shrink-0 self-start {isHighlighted ? 'text-primary' : 'text-success'}"
					/>
					<div class="min-w-0 flex-1">
						<p class="flex flex-wrap items-center gap-x-2 gap-y-1">
							<span class="font-mono text-[13px] text-foreground-muted">#{pr.number}</span>
							<span class="text-[15px] font-semibold tracking-tight">
								{pr.title === '' ? `PR #${pr.number}` : pr.title}
							</span>
							{#if isReviewed}
								<span class="rounded bg-secondary px-1.5 py-0.5 text-[12px] text-foreground-muted">
									reviewed
								</span>
							{/if}
						</p>
						<p class="mt-0.5 truncate font-mono text-[13px] text-foreground-muted">
							{pr.headRef} → {pr.base}{pr.createdAt === '' ? '' : ` · opened ${timeAgo(pr.createdAt)}`} · by {pr.author}
						</p>
					</div>
					<p class="hidden shrink-0 font-mono text-[13px] sm:block">
						<span class="text-foreground">{pr.changedFiles} files</span>
						<span class="text-foreground-muted"> · </span>
						<span class="text-success">+{pr.additions}</span>
						<span class="text-foreground-muted"> </span>
						<span class="text-error">−{pr.deletions}</span>
					</p>
					<Button
						size="sm"
						variant={isHighlighted ? 'primary' : 'outline'}
						class="h-10 shrink-0 px-2.5 font-sans"
						status={reviewTarget?.n === pr.number ? reviewTarget.status : 'idle'}
						loadingLabel="Queueing…"
						successLabel="Queued"
						onclick={() => void reviewPr(pr.number)}
					>
						{isReviewed ? 'Re-review' : 'Review'}
					</Button>
				</div>
			{:else}
				<p class="px-1 py-3 text-[14px] text-foreground-muted">
					{selected
						? filter.trim() === ''
							? 'No open pull requests.'
							: 'No pull requests match this filter.'
						: 'Select a repository to list its open pull requests.'}
				</p>
			{/each}
		{/if}
	</div>

	<h2 class="session-enter mt-10 text-[15px] font-medium" style="animation-delay: 220ms">Recent sessions</h2>
	<div class="session-enter mt-1 divide-y divide-border border-y border-border" style="animation-delay: 260ms" aria-busy={recentLoading}>
		{#if recentLoading}
			{#each [0, 1] as i (i)}
				<div class="flex items-center gap-2.5 px-1 py-2.5" role="status" aria-label="Loading sessions">
					<Skeleton class="h-[22px] w-40" />
					<Skeleton class="h-[18px] w-12" />
					<Skeleton class="h-[18px] w-24" />
					<Skeleton class="ml-auto h-[18px] w-16" />
				</div>
			{/each}
		{:else}
			{#each recent as session (session.id)}
			{@const sessionStatus = session.status === 'passed' ? 'ready' : 'reviewing'}
			<ContextMenu.Root>
				<ContextMenu.Trigger>
					<button
						type="button"
						onclick={() => openSession(session.id, session.repo, `#${session.pr}`, sessionStatus)}
						class="group flex w-full items-center gap-2.5 bg-transparent px-1 py-2.5 text-left transition-colors"
					>
						<span
							class="h-1.5 w-1.5 shrink-0 rounded-full"
							style:background-color={statusDot[session.status]}
						></span>
						<span class="font-mono text-[15px] group-hover:underline group-hover:underline-offset-4">{session.repo}</span>
						<span class="font-mono text-[13px] text-foreground-muted">#{session.pr}</span>
						<span class="font-mono text-[13px] text-foreground-muted">
							· {session.findings} finding{session.findings === 1 ? '' : 's'}
						</span>
						<span class="ml-auto text-[13px] text-foreground-muted">{session.status}</span>
					</button>
				</ContextMenu.Trigger>
				<ContextMenu.Content class="min-w-[13rem]">
					<ContextMenu.Item
						callback={() => openSession(session.id, session.repo, `#${session.pr}`, sessionStatus)}
					>
						<span class="flex items-center gap-2"><ArrowUpRight size={14} /> Open session</span>
					</ContextMenu.Item>
					<ContextMenu.Item callback={() => copySessionLink(session.id)}>
						<span class="flex items-center gap-2"><Link2 size={14} /> Copy link</span>
					</ContextMenu.Item>
					<ContextMenu.Item callback={() => copySessionId(session.id)}>
						<span class="flex items-center gap-2"><Hash size={14} /> Copy session ID</span>
					</ContextMenu.Item>
					<ContextMenu.Separator />
					<ContextMenu.Item
						callback={() => {
							pendingDeleteId = session.id;
							deleteDialogOpen = true;
						}}
					>
						<span class="flex items-center gap-2 text-[var(--color-error)]">
							<Trash2 size={14} /> Delete
						</span>
					</ContextMenu.Item>
				</ContextMenu.Content>
			</ContextMenu.Root>
			{:else}
				<p class="px-1 py-3 text-[14px] text-foreground-muted">No sessions yet.</p>
			{/each}
		{/if}
	</div>

	{#if !apiDown}
		<fieldset class="session-enter mt-10" style="animation-delay: 300ms">
			<legend class="text-[14px] font-medium">Connect</legend>
			<div class="mt-2 grid gap-2">
				{#if authLoading}
					{#each [0, 1] as i (i)}
						<div
							class="flex items-center gap-2.5 rounded-lg border border-border bg-card px-3 py-2.5"
							role="status"
							aria-label="Loading providers"
						>
							<Skeleton class="size-1.5 shrink-0 rounded-full" />
							<Skeleton class="h-[22px] w-20" />
							<Skeleton class="ml-auto h-[28px] w-[86px] shrink-0 rounded-lg" />
						</div>
					{/each}
				{:else if auth}
					{#each PROVIDERS as { id, label } (id)}
						{@const state = auth[id]}
						<div class="rounded-lg border border-border bg-card px-3 py-2.5">
							<div class="flex items-center gap-2.5">
								{#if state.authenticated}
									<span class="h-1.5 w-1.5 shrink-0 rounded-full bg-success"></span>
								{:else}
									<span class="h-1.5 w-1.5 shrink-0 rounded-full bg-foreground-muted/40"></span>
								{/if}
								<span class="text-[15px] font-medium">{label}</span>
								{#if state.authenticated && state.user}
									<span class="font-mono text-[13px] text-foreground-muted">{state.user}</span>
								{:else if !state.available}
									<span class="text-[13px] text-foreground-muted">CLI not installed</span>
								{/if}
								<span class="ml-auto flex items-center gap-1">
									{#if state.authenticated}
										<Button
											variant="ghost"
											size="sm"
											class="font-sans text-foreground-muted"
											onclick={() => void disconnect(id)}
										>
											Disconnect
										</Button>
									{:else if state.available}
										<Button
											variant="ghost"
											size="sm"
											class="font-sans"
											onclick={() => {
												connecting = connecting === id ? null : id;
												tokenInput = '';
												tokenError = null;
											}}
										>
											Connect
										</Button>
									{/if}
								</span>
							</div>
							<Collapsible.Root open={connecting === id}>
								<Collapsible.Content>
									<form
										class="mt-2"
										onsubmit={(e) => {
											e.preventDefault();
											void saveToken(id);
										}}
									>
										<div class="flex items-end gap-2">
											<div class="min-w-0 flex-1">
												<Input
													type="password"
													placeholder={id === 'github' ? 'ghp_… / github_pat_…' : 'glpat-…'}
													aria-label="Personal access token"
													bind:value={tokenInput}
												/>
											</div>
											<Button
												type="submit"
												variant="outline"
												size="sm"
												class="h-[var(--size-control-md)] shrink-0 font-sans"
												loading={tokenSaving}
											>
												Save
											</Button>
										</div>
										<p class="mt-1.5 text-[13px] text-foreground-muted">
											{id === 'github'
												? 'Needs repo scope. Stored in server memory only.'
												: 'Needs read_api + read_repository. Stored in server memory only.'}
										</p>
									</form>
									{#if tokenError && connecting === id}
										<p class="mt-1.5 text-[13px] font-medium text-error" role="alert">
											{tokenError}
										</p>
									{/if}
								</Collapsible.Content>
							</Collapsible.Root>
						</div>
					{/each}
				{/if}
			</div>
		</fieldset>
	{/if}

	<Modal.Root bind:open={browseOpen}>
		<Modal.Content size="lg">
			<Modal.Header>
				<Modal.Title>Your repositories</Modal.Title>
				<Modal.Description>Track one to review its pull requests.</Modal.Description>
			</Modal.Header>
			<Modal.Body>
				{#if remoteLoading}
					<div class="flex flex-col gap-2" role="status" aria-label="Listing repositories">
						<Skeleton class="h-[52px] w-full rounded-lg" />
						<Skeleton class="h-[52px] w-full rounded-lg" />
						<Skeleton class="h-[52px] w-5/6 rounded-lg" />
					</div>
				{:else if remoteError}
					<p class="text-[13px] font-medium text-error" role="alert">{remoteError}</p>
				{:else if remote.length === 0}
					<p class="m-0 text-[14px] text-foreground-muted">
						Connect GitHub or GitLab above to browse your repositories.
					</p>
				{:else}
					<ScrollArea aria-label="Your repositories" class="h-96">
						<div class="grid gap-2 pr-2">
							{#each remote as repo (repo.url)}
								{@const tracked = trackedNames.has(repo.url.replace(/\/$/, ''))}
								<div
									class="flex items-center gap-2.5 rounded-lg border border-border bg-card px-3 py-2"
								>
									<span class="min-w-0 flex-1 truncate font-mono text-[14px]">{repo.name}</span>
									<span class="shrink-0 text-[12px] text-foreground-muted">
										{repo.provider}{repo.isPrivate ? ' · private' : ''}
									</span>
									{#if tracked}
										<span class="shrink-0 text-[12px] text-success">Tracked</span>
									{:else}
										<Button
											variant="outline"
											size="sm"
											class="h-9 shrink-0 px-2 font-sans"
											loading={trackingId === repo.url}
											onclick={() => void trackRemote(repo)}
										>
											Track
										</Button>
									{/if}
								</div>
							{/each}
						</div>
					</ScrollArea>
				{/if}
			</Modal.Body>
		</Modal.Content>
	</Modal.Root>

	<AlertDialog.Root
		error
		bind:open={deleteDialogOpen}
		onOpenChange={(open) => {
			if (!open) pendingDeleteId = null;
		}}
	>
		<AlertDialog.Content>
			<AlertDialog.Header>
				<AlertDialog.Title>Delete this session?</AlertDialog.Title>
				<AlertDialog.Description>
					{#if pendingDelete}
						{pendingDelete.repo} #{pendingDelete.pr} with {pendingDelete.findings} finding{pendingDelete.findings === 1 ? '' : 's'} will
						be permanently removed.
					{:else}
						This session will be permanently removed.
					{/if}
					This action cannot be undone.
				</AlertDialog.Description>
			</AlertDialog.Header>
			<AlertDialog.Footer>
				<AlertDialog.Exit>
					Cancel
					<Shortcut shortcut="esc" />
				</AlertDialog.Exit>
				<AlertDialog.Confirm onclick={() => confirmDelete()}>
					Delete
					<Shortcut shortcut="enter" />
				</AlertDialog.Confirm>
			</AlertDialog.Footer>
		</AlertDialog.Content>
	</AlertDialog.Root>
	</div>
</div>
