<script lang="ts">
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import ArrowUpRight from '@lucide/svelte/icons/arrow-up-right';
	import Check from '@lucide/svelte/icons/check';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import GitPullRequest from '@lucide/svelte/icons/git-pull-request';
	import Hash from '@lucide/svelte/icons/hash';
	import Link2 from '@lucide/svelte/icons/link-2';
	import Plus from '@lucide/svelte/icons/plus';
	import RefreshCw from '@lucide/svelte/icons/refresh-cw';
	import Search from '@lucide/svelte/icons/search';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import * as Alert from '@sivir-ui/svelte/components/alert';
	import * as AlertDialog from '@sivir-ui/svelte/components/alert-dialog';
	import { Badge } from '@sivir-ui/svelte/components/badge';
	import { Button, type ButtonStatus } from '@sivir-ui/svelte/components/button';
	import * as Card from '@sivir-ui/svelte/components/card';
	import * as ContextMenu from '@sivir-ui/svelte/components/context-menu';
	import * as DropdownMenu from '@sivir-ui/svelte/components/dropdown-menu';
	import { Input } from '@sivir-ui/svelte/components/input';
	import * as Modal from '@sivir-ui/svelte/components/modal';
	import { ScrollArea } from '@sivir-ui/svelte/components/scroll-area';
	import Shortcut from '@sivir-ui/svelte/components/shortcut';
	import { Skeleton } from '@sivir-ui/svelte/components/skeleton';
	import { Spinner } from '@sivir-ui/svelte/components/spinner';
	import type { Provider, ProviderAuth, PullPreview, PullRequest, RemoteRepo, Repo, Review } from '@recoder/shared';
	import { serverApi } from '$lib/server-api';
	import { MODEL_ROLES, modelSettingsUi } from '$lib/model-settings.svelte';
	import { sessionState } from '$lib/session-state.svelte';

	interface ProgressSummary {
		tasksDone: number;
		tasksTotal: number;
		specialists: number;
	}

	interface RecentSession {
		id: string;
		repo: string;
		pr: number;
		findings: number;
		status: Review['status'];
		durationMs?: number;
		tasksDone?: number;
		tasksTotal?: number;
		specialists?: number;
		reason?: string;
		updatedAt: string;
	}

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

	const DEMO_RECENT: RecentSession[] = [
		{ id: 'demo-160-live', repo: 'sivir-ui', pr: 160, findings: 0, status: 'running', tasksDone: 14, tasksTotal: 22, specialists: 3, updatedAt: new Date(Date.now() - 2 * 60_000).toISOString() },
		{ id: 'demo-155-passed', repo: 'sivir-ui', pr: 155, findings: 0, status: 'passed', durationMs: 72_000, updatedAt: hoursAgoIso(24) },
		{ id: 'demo-160-passed', repo: 'sivir-ui', pr: 160, findings: 6, status: 'passed', durationMs: 124_000, updatedAt: hoursAgoIso(72) },
		{ id: 'demo-88-failed', repo: 'recoder', pr: 88, findings: 0, status: 'failed', durationMs: 18_000, reason: 'Local checkout failed', updatedAt: hoursAgoIso(48) }
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

	const statusDot = {
		passed: '#3fb96c',
		running: '#5b8cff',
		queued: '#8a8f98',
		failed: '#e0655f'
	} as const;

	let apiDown = $state(false);
	let repos = $state<Repo[]>([]);
	let recentLoading = $state(true);
	let allReviews = $state<Review[]>([]);
	let reviewSummaries = $state<Record<string, ProgressSummary>>({});
	let demoRecent = $state<RecentSession[]>(DEMO_RECENT);

	let auth = $state<{ github: ProviderAuth; gitlab: ProviderAuth } | null>(null);
	let authLoading = $state(true);
	let connecting = $state<Provider | null>(null);
	let connectOpen = $state(false);
	let tokenInput = $state('');
	let tokenSaving = $state(false);
	let tokenError = $state<string | null>(null);

	let browseOpen = $state(false);
	let remote = $state<RemoteRepo[]>([]);
	let remoteQuery = $state('');
	let remoteLoading = $state(false);
	let remoteError = $state<string | null>(null);
	let trackingId = $state<string | null>(null);

	let selectedRepo = $state<string | null>(null);
	let filter = $state('');
	let prs = $state<PullRequest[]>([]);
	let prsLoading = $state(true);
	let switchingRepo = $state(false);
	let prsError = $state<string | null>(null);
	let refreshing = $state(false);
	let reviewTarget = $state<{ n: number; status: ButtonStatus } | null>(null);
	let preview = $state<PullPreview | null>(null);
	let fetchingPreview = $state(false);
	let prError = $state<string | null>(null);
	let sortNewest = $state(true);
	let allSessionsOpen = $state(false);

	/** Reviews require a reviewer model — no model, no (stub) review. */
	const needsModel = $derived(
		!apiDown && !!modelSettingsUi.config && !modelSettingsUi.config.configured
	);

	const selected = $derived(repos.find((r) => r.id === selectedRepo));
	const trackedNames = $derived(new Set(repos.map((r) => r.url.replace(/\/$/, ''))));
	const latestByPr = $derived.by(() => {
		const map = new Map<string, Review>();
		for (const review of allReviews) {
			const key = `${review.repoId}#${review.prNumber}`;
			const current = map.get(key);
			if (!current || Date.parse(review.updatedAt) > Date.parse(current.updatedAt)) {
				map.set(key, review);
			}
		}
		return map;
	});
	const repoNameById = $derived(new Map(repos.map((r) => [r.id, r.name] as const)));
	const recent = $derived(
		apiDown ? demoRecent : mapRecent(allReviews, repoNameById, reviewSummaries)
	);
	const visibleRecent = $derived(recent.slice(0, 4));
	const reviewingCount = $derived(
		recent.filter((s) => s.status === 'running' || s.status === 'queued').length
	);
	const providerRows = $derived<({ provider: Provider; label: string } & ProviderAuth)[]>(
		apiDown
			? DEMO_AUTH
			: auth
				? PROVIDERS.map(({ id, label }) => ({ ...auth![id], label }))
				: []
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
	const displayPrs = $derived.by(() => {
		const fetched = preview;
		const list =
			!fetched || prs.some((p) => p.number === fetched.pr.number)
				? filtered
				: [fetched.pr, ...filtered];
		const sorted = [...list];
		sorted.sort((a, b) => {
			const ta = Date.parse(a.createdAt) || 0;
			const tb = Date.parse(b.createdAt) || 0;
			return sortNewest ? tb - ta : ta - tb;
		});
		return sorted;
	});

	function mapRecent(
		reviews: Review[],
		names: Map<string, string>,
		summaries: Record<string, ProgressSummary>
	): RecentSession[] {
		return reviews
			.map((review) => {
				const summary = summaries[review.id];
				const start = Date.parse(review.createdAt);
				const end = Date.parse(review.updatedAt);
				return {
					id: review.id,
					repo: names.get(review.repoId) ?? review.repoId.slice(0, 8),
					pr: review.prNumber,
					findings: review.findings.length,
					status: review.status,
					durationMs:
						Number.isFinite(start) && Number.isFinite(end)
							? Math.max(0, end - start)
							: undefined,
					tasksDone: summary?.tasksDone,
					tasksTotal: summary?.tasksTotal,
					specialists: summary?.specialists,
					reason: review.status === 'failed' ? (review.summary ?? undefined) : undefined,
					updatedAt: review.updatedAt
				};
			})
			.sort((a, b) => (Date.parse(b.updatedAt) || 0) - (Date.parse(a.updatedAt) || 0));
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

	function formatDuration(ms: number): string {
		const seconds = Math.max(0, Math.floor(ms / 1000));
		return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
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

	function recentHeadline(session: RecentSession): string {
		if (session.status === 'running' || session.status === 'queued') {
			const parts: string[] = [];
			if (session.tasksTotal) {
				parts.push(`${session.tasksDone ?? 0} of ${session.tasksTotal} tasks`);
			}
			if (session.specialists) {
				parts.push(`${plural(session.specialists, 'specialist')} working`);
			}
			if (parts.length === 0) {
				parts.push(session.findings > 0 ? `${plural(session.findings, 'finding')} so far` : 'Starting…');
			}
			return parts.join(' · ');
		}
		const parts: string[] = [];
		if (session.status === 'failed') {
			parts.push(session.reason?.split('\n')[0] ?? 'Review failed');
		} else {
			parts.push(plural(session.findings, 'finding'));
		}
		if (session.durationMs !== undefined) parts.push(formatDuration(session.durationMs));
		if (session.updatedAt) parts.push(timeAgo(session.updatedAt));
		return parts.join(' · ');
	}

	function recentStatusLabel(session: RecentSession): string {
		return session.status === 'running' || session.status === 'queued' ? 'reviewing' : session.status;
	}

	function reviewDuration(review: Review): string {
		const start = Date.parse(review.createdAt);
		const end = Date.parse(review.updatedAt);
		if (!Number.isFinite(start) || !Number.isFinite(end)) return '';
		return formatDuration(Math.max(0, end - start));
	}

	onMount(async () => {
		void serverApi
			.reviewSummaries()
			.then((summaries) => (reviewSummaries = summaries))
			.catch(() => {
				// Older server builds omit the summaries route — recent rows degrade gracefully.
			});
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
			if (!selectedRepo && fetchedRepos.length > 0) selectedRepo = fetchedRepos[0].id;
			await loadPrs();
		} catch {
			apiDown = true;
			repos = DEMO_REPOS;
			demoRecent = DEMO_RECENT;
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

	function openConnect(provider: Provider): void {
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

	function openReviewSession(review: Review, name: string): void {
		const status =
			review.status === 'passed' || review.status === 'failed' ? 'ready' : 'reviewing';
		openSession(review.id, name, `#${review.prNumber}`, status);
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
			demoRecent = demoRecent.filter((s) => s.id !== id);
			// Drop the matching tab too, if one is open.
			sessionState.close(id);
		} catch (e) {
			prError = e instanceof Error ? e.message : 'Failed to delete session.';
		} finally {
			deletingId = null;
		}
	}

	function selectRepo(id: string): void {
		if (selectedRepo === id || switchingRepo) return;
		selectedRepo = id;
		filter = '';
		preview = null;
		reviewTarget = null;
		prError = null;
		// Visible loading state: the PR list shows skeletons until the new repo's PRs arrive.
		switchingRepo = true;
		refreshing = true;
		void loadPrs(true).finally(() => {
			switchingRepo = false;
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
			const [reviews, summaries] = await Promise.all([
				serverApi.listReviews(),
				serverApi.reviewSummaries().catch(() => reviewSummaries)
			]);
			allReviews = reviews;
			reviewSummaries = summaries;
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

	async function reviewPr(n: number, repo: Pick<Repo, 'id' | 'name'> | undefined = selected): Promise<void> {
		if (!repo || reviewTarget) return;
		if (!apiDown && modelSettingsUi.config && !modelSettingsUi.config.configured) {
			prError = 'Add a reviewer model first — reviews cannot run without one.';
			modelSettingsUi.show();
			return;
		}
		reviewTarget = { n, status: 'loading' };
		prError = null;
		if (apiDown) {
			await new Promise((r) => setTimeout(r, 900));
			const session = sessionState.restartReview(repo.id, repo.name, `#${n}`);
			reviewTarget = { n, status: 'success' };
			await new Promise((r) => setTimeout(r, 350));
			await goto(`/session/${session.id}`);
			return;
		}
		try {
			const review = await serverApi.queueReview({ repoId: repo.id, prNumber: n });
			await refreshReviews();
			reviewTarget = { n, status: 'success' };
			await new Promise((r) => setTimeout(r, 350));
			openReviewSession(review, repo.name);
		} catch (e) {
			reviewTarget = null;
			prError = e instanceof Error ? e.message : 'Failed to queue review.';
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
	<Input
		placeholder="Filter open PRs, or paste a pull request URL"
		aria-label="Filter open PRs, or paste a pull request URL"
		bind:value={filter}
		disabled={!selected}
		oninput={() => {
			prError = null;
			preview = null;
		}}
	>
		{#snippet leading()}
			<Search size={15} />
		{/snippet}
	</Input>
{/snippet}

<div class="flex h-full flex-col overflow-hidden lg:flex-row">
	<!-- Repositories + reviewer -->
	<aside
		aria-label="Repositories"
		class="hidden w-[340px] shrink-0 flex-col border-r border-border bg-background lg:flex"
	>
			<ScrollArea class="min-h-0 flex-1" showCues={false}>
			<div class="flex flex-col gap-1 p-3">
				<h2 class="px-1 pb-1 text-[13px] font-medium text-foreground-muted">Repositories</h2>
				{#if authLoading}
					{#each [0, 1, 2] as i (i)}
						<Skeleton class="h-9 w-full rounded-md" />
					{/each}
				{:else if repos.length > 0}
					<nav class="flex flex-col gap-0.5" aria-label="Tracked repositories">
						{#each repos as repo (repo.id)}
							<Button
								unstyled
								type="button"
								aria-current={selectedRepo === repo.id ? 'true' : undefined}
								onclick={() => selectRepo(repo.id)}
								class="flex h-9 w-full items-center gap-2.5 rounded-md px-2 text-left transition-colors {selectedRepo ===
								repo.id
									? 'bg-secondary text-foreground'
									: 'text-foreground-muted hover:bg-secondary/50 hover:text-foreground'}"
							>
								<span class="flex shrink-0 items-center text-foreground-muted">
									{@render providerMark(repo.provider, 14)}
								</span>
								<span class="truncate font-mono text-[14px]">{repo.name}</span>
							</Button>
						{/each}
					</nav>
				{:else}
					<p class="px-1 py-2 text-[14px] text-foreground-muted">No repositories tracked.</p>
				{/if}
				<Button
					variant="ghost"
					class="mt-1 justify-start font-sans text-foreground-muted"
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
							<span class="h-1.5 w-1.5 shrink-0 rounded-full bg-success"></span>
						{:else}
							<span class="h-1.5 w-1.5 shrink-0 rounded-full bg-foreground-muted/40"></span>
						{/if}
						<span class="flex shrink-0 items-center text-foreground">
							{@render providerMark(provider.provider, 14)}
						</span>
						{#if provider.authenticated && provider.user}
							<span class="truncate font-mono text-foreground-muted">{provider.user}</span>
						{:else if !provider.available}
							<span class="truncate text-foreground-muted">CLI not installed</span>
						{:else}
							<span class="truncate text-foreground-muted">Not connected</span>
						{/if}
						<span class="ml-auto shrink-0">
							{#if provider.authenticated}
								<Button
									variant="quiet"
									class="h-7 px-2 text-[12px] text-foreground-muted hover:bg-secondary"
									onclick={() => void disconnect(provider.provider)}
								>
									Disconnect
								</Button>
							{:else if provider.available}
								<Button
									variant="quiet"
									class="h-7 px-2 text-[12px] text-primary dark:text-[#9e99f3] hover:bg-secondary"
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
	</aside>

	<!-- Main + recent sessions -->
	<div class="flex min-h-0 min-w-0 flex-1 flex-col xl:flex-row">
		<section class="flex min-h-0 min-w-0 flex-1 flex-col" aria-label="Start a review">
			<div class="shrink-0 px-3">
				<div class="mx-auto flex w-full max-w-[960px] flex-wrap items-center gap-2 py-3">
				{#if authLoading}
					<Skeleton class="h-[var(--size-control-md)] w-52 shrink-0 rounded-lg" />
					<div class="min-w-0 flex-1">{@render filterInput()}</div>
				{:else if repos.length > 0}
					<div class="flex min-w-0 flex-1 items-stretch">
					<DropdownMenu.Root>
						<DropdownMenu.Trigger
							variant="outline"
							aria-label="Select repository"
							class="h-[var(--size-control-md)] w-64 shrink-0 justify-between rounded-r-none font-mono text-[14px]"
						>
							<span class="flex min-w-0 items-center gap-2.5">
								<span class="truncate">{selected?.name ?? 'Select repository'}</span>
							</span>
							{#if switchingRepo}
								<Spinner size={15} class="shrink-0 text-foreground-muted" aria-label="Loading pull requests" />
							{:else}
								<ChevronDown size={15} class="shrink-0 text-foreground-muted" />
							{/if}
						</DropdownMenu.Trigger>
						<DropdownMenu.Content
							class="max-w-[min(20rem,calc(100vw-2rem))] [&_[data-ui=scroll-area]]:w-auto [&_[data-ui=scroll-area]]:max-w-none"
						>
							<DropdownMenu.RadioGroup
								value={selectedRepo ?? ''}
								onValueChange={(v) => selectRepo(v)}
							>
								{#each repos as repo (repo.id)}
									<DropdownMenu.RadioItem value={repo.id}>
										<span class="flex min-w-0 flex-1 items-center gap-2.5">
											<span class="truncate font-mono text-[14px]">{repo.name}</span>
											<span class="ml-auto flex shrink-0 items-center pl-3 text-foreground-muted">
												{@render providerMark(repo.provider, 13)}
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
					<div class="min-w-0 flex-1 [&_[data-ui=input-control]]:rounded-l-none [&_[data-ui=input-control]]:border-l-0">{@render filterInput()}</div>
					</div>
				{:else}
					<Button variant="outline" class="shrink-0 font-sans" onclick={openBrowse}>
						<Plus size={15} /> Add repository
					</Button>
					<div class="min-w-0 flex-1">{@render filterInput()}</div>
				{/if}
				<Button
					variant="outline"
					class="shrink-0 font-sans"
					loading={refreshing}
					disabled={!selected}
					onclick={() => void refreshAll()}
				>
					<RefreshCw size={15} /> Refresh
				</Button>
				</div>
			</div>

			<ScrollArea class="min-h-0 flex-1" aria-label="Open pull requests" showCues={false}>
				<div class="mx-auto flex w-full max-w-[960px] flex-col gap-3 p-4">
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

					<div class="flex items-baseline justify-between gap-3">
						<h2 class="text-[15px] font-medium">
							Open pull requests
							<span class="text-foreground-muted tabular-nums">{prsLoading || switchingRepo ? '…' : displayPrs.length}</span>
						</h2>
						<DropdownMenu.Root>
							<DropdownMenu.Trigger
								variant="ghost"
								class="-mr-1 shrink-0 font-sans text-[13px] text-foreground-muted"
								aria-label="Sort pull requests"
							>
								{sortNewest ? 'Newest first' : 'Oldest first'}
								<ChevronDown size={14} />
							</DropdownMenu.Trigger>
							<DropdownMenu.Content class="w-44">
								<DropdownMenu.RadioGroup
									value={sortNewest ? 'newest' : 'oldest'}
									onValueChange={(v) => (sortNewest = v === 'newest')}
								>
									<DropdownMenu.RadioItem value="newest">
										<span class="min-w-0 flex-1 text-left">Newest first</span>
									</DropdownMenu.RadioItem>
									<DropdownMenu.RadioItem value="oldest">
										<span class="min-w-0 flex-1 text-left">Oldest first</span>
									</DropdownMenu.RadioItem>
								</DropdownMenu.RadioGroup>
							</DropdownMenu.Content>
						</DropdownMenu.Root>
					</div>

					{#if prError}
						<p class="text-[13px] font-medium text-error" role="alert">{prError}</p>
					{/if}

					<div class="flex flex-col gap-2" aria-busy={prsLoading || switchingRepo}>
						{#if prsLoading || switchingRepo}
							{#each [0, 1, 2] as i (i)}
								<div role="status" aria-label="Loading pull requests">
									<Card.Root class="flex min-w-0 flex-row items-center gap-3 p-4">
										<Skeleton class="mt-0.5 size-[18px] shrink-0 self-start rounded-full" />
										<div class="min-w-0 flex-1">
											<Skeleton class="h-[22px] w-2/3" />
											<Skeleton class="mt-0.5 h-5 w-1/2" />
										</div>
										<Skeleton class="hidden h-5 w-32 shrink-0 sm:block" />
										<Skeleton class="h-[34px] w-[84px] shrink-0 rounded-lg" />
									</Card.Root>
								</div>
							{/each}
						{:else if prsError}
							<Alert.Root variant="error">
								<Alert.Title>Could not load pull requests</Alert.Title>
								<Alert.Description>{prsError}</Alert.Description>
								<Button variant="outline" class="mt-2 w-fit font-sans" onclick={() => void loadPrs()}>
									Retry
								</Button>
							</Alert.Root>
						{:else}
							{#if showFetchCard && pastedNumber !== null}
								<Card.Root class="flex min-w-0 flex-row items-center gap-3 border-dashed p-3">
									<p class="min-w-0 flex-1 truncate font-mono text-[13px] text-foreground-muted">
										PR #{pastedNumber} isn’t in the open list.
									</p>
									<Button
										variant="outline"
										class="shrink-0 font-sans"
										loading={fetchingPreview}
										onclick={() => void fetchPreview(pastedNumber)}
									>
										Fetch
									</Button>
								</Card.Root>
							{/if}
							{#each displayPrs as pr (pr.number)}
								{@const review = selected ? latestByPr.get(`${selected.id}#${pr.number}`) : undefined}
								{@const isReviewed = review !== undefined}
								{@const isHighlighted = highlightN === pr.number}
								{@const expanded =
									!!review &&
									(review.status === 'running' ||
										review.status === 'queued' ||
										sessionState.activeId === review.id)}
								{@const summary = review ? reviewSummaries[review.id] : undefined}
								<Card.Root
									class="flex min-w-0 flex-col p-4 transition-colors {isHighlighted
										? 'border-primary/60 bg-primary/[0.05]'
										: ''}"
								>
									<div class="flex min-w-0 items-start gap-3">
										<GitPullRequest
											size={18}
											class="mt-0.5 shrink-0 {isHighlighted ? 'text-primary' : 'text-success'}"
										/>
										<div class="min-w-0 flex-1">
											<p class="flex flex-wrap items-center gap-x-2 gap-y-1">
												<span class="font-mono text-[13px] text-foreground-muted">#{pr.number}</span>
												<span class="text-[15px] font-semibold tracking-tight">
													{pr.title === '' ? `PR #${pr.number}` : pr.title}
												</span>
												{#if isReviewed}
													<Badge variant="secondary">Reviewed</Badge>
												{/if}
											</p>
											<p class="mt-0.5 truncate font-mono text-[13px] text-foreground-muted">
												{pr.headRef} → {pr.base} · {plural(pr.changedFiles, 'file')}
												<span class="text-success">+{pr.additions}</span>
												<span class="text-error">−{pr.deletions}</span>
												{pr.createdAt === '' ? '' : ` · opened ${timeAgo(pr.createdAt)}`} · by {pr.author}
											</p>
										</div>
										<div class="flex shrink-0 items-center gap-2">
											{#if expanded && review && selected}
												<Button
													variant="outline"
													class="font-sans"
													onclick={() => openReviewSession(review, selected.name)}
												>
													Open diff
												</Button>
											{/if}
											<Button
												variant={isReviewed && !isHighlighted ? 'secondary' : 'primary'}
												class="font-sans"
												status={reviewTarget?.n === pr.number ? reviewTarget.status : 'idle'}
												loadingLabel="Queueing…"
												successLabel="Queued"
												onclick={() => void reviewPr(pr.number)}
											>
												{#if isReviewed}
												<RefreshCw size={14} aria-hidden="true" />
											{/if}
											{isReviewed ? 'Re-review' : 'Review'}
											</Button>
										</div>
									</div>

									{#if expanded && review && selected}
										<div class="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-border pt-3 text-[13px] text-foreground-muted">
											{#if review.status === 'running' || review.status === 'queued'}
												<Spinner size={13} aria-hidden="true" />
											{:else}
												<span
													class="h-1.5 w-1.5 shrink-0 rounded-full"
													style:background-color={statusDot[review.status]}
												></span>
											{/if}
											<span>
												Last review {review.status === 'passed'
													? 'passed'
													: review.status === 'failed'
														? 'failed'
														: 'started'}
												{timeAgo(review.updatedAt)}
											</span>
											<span aria-hidden="true">·</span>
											<span>{plural(review.findings.length, 'finding')}</span>
											{#if summary && summary.tasksTotal > 0}
												<span aria-hidden="true">·</span>
												<span>{summary.tasksTotal} tasks</span>
											{/if}
											{#if reviewDuration(review) !== ''}
												<span aria-hidden="true">·</span>
												<span class="font-mono tabular-nums">{reviewDuration(review)}</span>
											{/if}
											<Button
												variant="quiet"
												class="ml-auto shrink-0 font-sans text-[13px] text-primary dark:text-[#9e99f3] hover:underline hover:underline-offset-4"
												onclick={() => openReviewSession(review, selected.name)}
											>
												Open session
											</Button>
										</div>
									{:else if isReviewed && review && selected}
										<div
											class="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-border pt-3 text-[13px] text-foreground-muted"
										>
											<span
												class="h-1.5 w-1.5 shrink-0 rounded-full"
												style:background-color={statusDot[review.status]}
											></span>
											<span>Reviewed {timeAgo(review.updatedAt)}</span>
											<span aria-hidden="true">·</span>
											<span>{plural(review.findings.length, 'finding')}</span>
											{#if reviewDuration(review) !== ''}
												<span aria-hidden="true">·</span>
												<span class="font-mono tabular-nums">{reviewDuration(review)}</span>
											{/if}
											<Button
												variant="quiet"
												class="ml-auto shrink-0 font-sans text-[13px] text-primary dark:text-[#9e99f3] hover:underline hover:underline-offset-4"
												onclick={() => openReviewSession(review, selected.name)}
											>
												Open session
											</Button>
										</div>
									{/if}
								</Card.Root>
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
				</div>
			</ScrollArea>
		</section>

		<!-- Recent sessions -->
		<aside
			aria-label="Recent sessions"
			class="flex shrink-0 flex-col border-t border-border xl:w-[360px] xl:border-t-0 xl:border-l"
		>
			<div class="flex shrink-0 items-center justify-between gap-2 px-4 py-3">
				<h2 class="text-[15px] font-medium">Recent sessions</h2>
				{#if recent.length > 0}
					<Button
						variant="quiet"
						class="h-auto px-0 font-sans text-[13px] text-primary dark:text-[#9e99f3] hover:bg-transparent hover:underline hover:underline-offset-4"
						onclick={() => (allSessionsOpen = true)}
					>
						See all
					</Button>
				{/if}
			</div>

			<ScrollArea class="min-h-0 flex-1" aria-label="Recent sessions" showCues={false}>
				<div class="flex flex-col gap-2 px-4 pb-3" aria-busy={recentLoading}>
					{#if recentLoading}
						{#each [0, 1, 2] as i (i)}
							<Card.Root class="flex flex-col gap-2 p-3">
								<div class="flex items-center gap-2">
									<Skeleton class="h-[18px] w-28" />
									<Skeleton class="ml-auto h-[18px] w-16" />
								</div>
								<Skeleton class="h-[16px] w-40" />
							</Card.Root>
						{/each}
					{:else}
						{#each visibleRecent as session (session.id)}
							{@const sessionStatus =
								session.status === 'passed' || session.status === 'failed'
									? 'ready'
									: 'reviewing'}
							{@const repoId = apiDown
								? undefined
								: allReviews.find((r) => r.id === session.id)?.repoId}
							<ContextMenu.Root>
								<ContextMenu.Trigger>
									<Button
										unstyled
										type="button"
										onclick={() =>
											openSession(session.id, session.repo, `#${session.pr}`, sessionStatus)}
										class="group flex w-full flex-col gap-1 rounded-[var(--radius-lg)] border-[length:var(--border-size)] border-border bg-card p-3 text-left transition-colors hover:bg-secondary"
									>
										<span class="flex min-w-0 items-center gap-2">
											<span class="truncate font-mono text-[14px] text-foreground">
												{session.repo} <span class="text-foreground-muted">#{session.pr}</span>
											</span>
											<span class="ml-auto flex shrink-0 items-center gap-2">
												{#if session.status === 'running' || session.status === 'queued'}
													<Spinner size={12} aria-hidden="true" />
												{:else}
													<span
														class="h-1.5 w-1.5 rounded-full"
														style:background-color={statusDot[session.status]}
													></span>
												{/if}
												<span
													class:text-success={session.status === 'passed'}
													class:text-error={session.status === 'failed'}
													class:text-info-vivid={session.status === 'running' ||
														session.status === 'queued'}
													class="text-[13px] font-medium"
												>
													{recentStatusLabel(session)}
												</span>
											</span>
										</span>
										<span class="truncate font-mono text-[12px] text-foreground-muted">
											{recentHeadline(session)}
										</span>
									</Button>
								</ContextMenu.Trigger>
								<ContextMenu.Content class="min-w-[13rem]">
									<ContextMenu.Item
										callback={() =>
											openSession(session.id, session.repo, `#${session.pr}`, sessionStatus)}
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
										disabled={!repoId || !!reviewTarget || deletingId === session.id}
										callback={() => {
											if (repoId) void reviewPr(session.pr, { id: repoId, name: session.repo });
										}}
									>
										<span class="flex items-center gap-2">
											<RefreshCw size={14} aria-hidden="true" /> Re-review
										</span>
									</ContextMenu.Item>
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
			</ScrollArea>

			<div class="shrink-0 px-4 pt-2 pb-3">
				<h2 class="pb-1 text-[13px] font-medium text-foreground-muted">Reviewer</h2>
				{#if !apiDown && !modelSettingsUi.config}
					<Card.Root class="p-3">
						<Skeleton class="h-4 w-24 rounded-md" />
						<Skeleton class="mt-2 h-3 w-40 rounded-md" />
					</Card.Root>
				{:else}
					<Button
						unstyled
						type="button"
						onclick={() => modelSettingsUi.show()}
						class="group flex w-full items-center gap-3 rounded-[var(--radius-lg)] border-[length:var(--border-size)] border-border bg-card p-3 text-left transition-colors hover:bg-secondary"
					>
						<span class="min-w-0 flex-1">
							{#if apiDown}
								<span class="block text-[15px] font-medium">{MODEL_ROLES.length} specialists</span>
								<span class="mt-0.5 block truncate font-mono text-[12px] text-foreground-muted">
									qwen2.5-coder-32b-instruct
								</span>
							{:else if modelSettingsUi.config?.configured}
								<span class="block text-[15px] font-medium">{MODEL_ROLES.length} specialists</span>
								<span class="mt-0.5 block truncate font-mono text-[12px] text-foreground-muted">
									{modelSettingsUi.config.model}
								</span>
							{:else}
								<span class="block text-[14px] text-foreground-muted">No reviewer model configured</span>
							{/if}
						</span>
						<ChevronRight
							size={16}
							class="shrink-0 text-foreground-muted transition-transform group-hover:translate-x-0.5"
						/>
					</Button>
				{/if}
			</div>

			{#if reviewingCount > 0}
				<p class="shrink-0 border-t border-border px-4 py-3 text-[13px] text-foreground-muted">
					{plural(reviewingCount, 'review')} in progress.
				</p>
			{/if}
		</aside>
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

<Modal.Root bind:open={allSessionsOpen}>
	<Modal.Content size="lg">
		<Modal.Header>
			<Modal.Title>All sessions</Modal.Title>
		</Modal.Header>
		<Modal.Body>
			<ScrollArea aria-label="All sessions" class="max-h-[60dvh]" showCues={false}>
				<div class="flex flex-col gap-2 pr-2">
					{#each recent as session (session.id)}
						{@const sessionStatus =
							session.status === 'passed' || session.status === 'failed' ? 'ready' : 'reviewing'}
						<Button
							unstyled
							type="button"
							onclick={() => {
								allSessionsOpen = false;
								openSession(session.id, session.repo, `#${session.pr}`, sessionStatus);
							}}
							class="flex w-full flex-col gap-1 rounded-[var(--radius-lg)] border-[length:var(--border-size)] border-border bg-card p-3 text-left transition-colors hover:bg-secondary"
						>
							<span class="flex min-w-0 items-center gap-2">
								<span class="truncate font-mono text-[14px] text-foreground">
									{session.repo} <span class="text-foreground-muted">#{session.pr}</span>
								</span>
								<span class="ml-auto flex shrink-0 items-center gap-2">
									{#if session.status === 'running' || session.status === 'queued'}
										<Spinner size={12} aria-hidden="true" />
									{:else}
										<span
											class="h-1.5 w-1.5 rounded-full"
											style:background-color={statusDot[session.status]}
										></span>
									{/if}
									<span
										class:text-success={session.status === 'passed'}
										class:text-error={session.status === 'failed'}
										class:text-info-vivid={session.status === 'running' ||
											session.status === 'queued'}
										class="text-[13px] font-medium"
									>
										{recentStatusLabel(session)}
									</span>
								</span>
							</span>
							<span class="truncate font-mono text-[12px] text-foreground-muted">
								{recentHeadline(session)}
							</span>
						</Button>
					{:else}
						<p class="px-1 py-3 text-[14px] text-foreground-muted">No sessions yet.</p>
					{/each}
				</div>
			</ScrollArea>
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
					{pendingDelete.repo} #{pendingDelete.pr} with {plural(pendingDelete.findings, 'finding')} will
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
