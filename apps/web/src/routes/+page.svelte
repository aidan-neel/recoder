<script lang="ts">
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import Moon from '@lucide/svelte/icons/moon';
	import Settings from '@lucide/svelte/icons/settings';
	import Sun from '@lucide/svelte/icons/sun';
	import { Button, type ButtonStatus } from '@sivir-ui/svelte/components/button';
	import * as Alert from '@sivir-ui/svelte/components/alert';
	import * as Card from '@sivir-ui/svelte/components/card';
	import * as Collapsible from '@sivir-ui/svelte/components/collapsible';
	import { Input } from '@sivir-ui/svelte/components/input';
	import * as Modal from '@sivir-ui/svelte/components/modal';
	import { ScrollArea } from '@sivir-ui/svelte/components/scroll-area';
	import { Skeleton } from '@sivir-ui/svelte/components/skeleton';
	import { Spinner } from '@sivir-ui/svelte/components/spinner';
	import type { Provider, ProviderAuth, PullPreview, RemoteRepo, Repo, Review } from '@recoder/shared';
	import { detectProvider, serverApi } from '$lib/server-api';
	import { modelSettingsUi } from '$lib/model-settings.svelte';
	import { sessionState } from '$lib/session-state.svelte';
	import { theme } from '$lib/theme.svelte';

	interface RecentSession {
		id: string;
		repo: string;
		pr: number;
		status: 'passed' | 'running' | 'queued' | 'failed';
	}

	const DEMO_REPOS: Repo[] = [
		{ id: 'ledger-api', name: 'acme/ledger-api', url: 'https://github.com/acme/ledger-api', provider: 'github', defaultBranch: 'main', createdAt: '', updatedAt: '' },
		{ id: 'gateway', name: 'acme/gateway', url: 'https://github.com/acme/gateway', provider: 'github', defaultBranch: 'main', createdAt: '', updatedAt: '' },
		{ id: 'infra', name: 'infra/local', url: 'https://gitlab.com/infra/local', provider: 'gitlab', defaultBranch: 'main', createdAt: '', updatedAt: '' }
	];

	const DEMO_RECENT: RecentSession[] = [
		{ id: 'ledger-api', repo: 'ledger-api', pr: 4127, status: 'passed' },
		{ id: 'gateway', repo: 'gateway', pr: 902, status: 'running' },
		{ id: 'console', repo: 'console', pr: 3310, status: 'queued' }
	];

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
	let recent = $state<RecentSession[]>(DEMO_RECENT);

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
	let prInput = $state('');
	let prState = $state<'idle' | 'loading' | 'ready'>('idle');
	let prError = $state<string | null>(null);
	let prNumber = $state(0);
	let preview = $state<PullPreview | null>(null);
	let requestStatus = $state<ButtonStatus>('idle');

	const selected = $derived(repos.find((r) => r.id === selectedRepo));
	const canFetch = $derived(selected && prInput.trim().length > 0 && prState !== 'loading');
	const trackedNames = $derived(new Set(repos.map((r) => r.url.replace(/\/$/, ''))));
	const isConnected = $derived(
		apiDown || !!(auth && (auth.github.authenticated || auth.gitlab.authenticated))
	);

	const reviewStatusFor = (status: Review['status']): RecentSession['status'] =>
		status === 'failed' ? 'failed' : status;

	onMount(async () => {
		theme.ensureLoaded();
		try {
			const [status, fetchedRepos, reviews] = await Promise.all([
				serverApi.authStatus(),
				serverApi.listRepos(),
				serverApi.listReviews()
			]);
			auth = status;
			if (status.github.authenticated || status.gitlab.authenticated) void loadRemote();
			repos = fetchedRepos;
			const names = new Map(fetchedRepos.map((r) => [r.id, r.name] as const));
			recent = reviews.map((review) => ({
				id: review.id,
				repo: names.get(review.repoId) ?? review.repoId.slice(0, 8),
				pr: review.prNumber,
				status: reviewStatusFor(review.status)
			}));
		} catch {
			apiDown = true;
			repos = DEMO_REPOS;
			recent = DEMO_RECENT;
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

	function selectRepo(id: string): void {
		selectedRepo = id;
		prState = 'idle';
		prError = null;
		preview = null;
	}

	async function fetchPr(event: SubmitEvent): Promise<void> {
		event.preventDefault();
		prError = null;
		preview = null;
		if (!selected) {
			prError = 'Choose a repository first.';
			return;
		}
		const digits = prInput.replace(/\D/g, '');
		if (digits === '') {
			prError = 'Enter a PR number or paste a pull request URL.';
			return;
		}
		prNumber = Number.parseInt(digits, 10);
		prState = 'loading';
		if (apiDown) {
			await new Promise((r) => setTimeout(r, 600));
			prState = 'ready';
			return;
		}
		try {
			preview = await serverApi.previewPr(selected.id, prNumber);
			prState = 'ready';
		} catch (e) {
			prState = 'idle';
			prError = e instanceof Error ? e.message : 'Failed to fetch PR.';
		}
	}

	async function requestReview(): Promise<void> {
		if (requestStatus === 'loading' || !selected) return;
		requestStatus = 'loading';
		if (apiDown) {
			await new Promise((r) => setTimeout(r, 900));
			requestStatus = 'success';
			const session = sessionState.restartReview(selected.id, selected.name, `#${prNumber}`);
			await new Promise((r) => setTimeout(r, 350));
			await goto(`/session/${session.id}`);
			return;
		}
		try {
			const review = await serverApi.queueReview({ repoId: selected.id, prNumber });
			requestStatus = 'success';
			await new Promise((r) => setTimeout(r, 350));
			openSession(review.id, selected.name, `#${prNumber}`, 'reviewing');
		} catch (e) {
			requestStatus = 'idle';
			prError = e instanceof Error ? e.message : 'Failed to queue review.';
		}
	}

	const fileTotals = $derived(
		preview
			? {
					files: preview.files.length,
					additions: preview.files.reduce((sum, f) => sum + f.additions, 0),
					deletions: preview.files.reduce((sum, f) => sum + f.deletions, 0)
				}
			: null
	);
</script>

<div class="mx-auto flex min-h-[calc(100vh-8rem)] w-full max-w-xl flex-col justify-center px-4 py-10">
	<div class="flex items-center justify-between gap-2">
		<h1 class="text-2xl font-semibold tracking-tight">Start a review</h1>
		<div class="flex shrink-0 items-center gap-1">
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
	<p class="mt-1 text-[15px] leading-relaxed text-foreground-muted">
		Pick a repository and pull request. Recoder fetches the diff and spins up reviewer
		subagents.
	</p>

	{#if apiDown}
		<Alert.Root variant="warning" class="mt-4">
			<Alert.Title>API unreachable</Alert.Title>
			<Alert.Description>
				Showing demo data. Start the server with <code class="font-mono">bun run dev:server</code>
				for live fetching.
			</Alert.Description>
		</Alert.Root>
	{:else}
		<fieldset class="mt-8">
			<legend class="text-[14px] font-medium">Connect</legend>
			<div class="mt-2 grid gap-2">
				{#if authLoading}
					<Skeleton class="h-[68px] w-full rounded-lg" />
					<Skeleton class="h-[68px] w-full rounded-lg" />
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

	<Collapsible.Root open={isConnected}>
		<Collapsible.Content>
			<fieldset class="mt-8">
				<div class="flex items-center justify-between">
					<legend class="text-[14px] font-medium">Repository</legend>
					{#if !apiDown}
						<Button
							variant="outline"
							size="sm"
							class="h-9 shrink-0 font-sans"
							onclick={openBrowse}
						>
							+ Add repository
						</Button>
					{/if}
				</div>
				<div class="mt-2 grid gap-2">
					{#each repos as repo (repo.id)}
						<label
							class="flex cursor-pointer items-center gap-2.5 rounded-lg border px-3 py-2.5 transition-colors {selectedRepo ===
							repo.id
								? 'border-[#5698ff]/60 bg-[#141c28]/60'
								: 'border-border bg-card hover:border-foreground/20'}"
						>
							<input
								type="radio"
								name="repo"
								value={repo.id}
								checked={selectedRepo === repo.id}
								onchange={() => selectRepo(repo.id)}
								class="sr-only"
							/>
							<span class="h-1.5 w-1.5 shrink-0 rounded-full bg-success"></span>
							<span class="font-mono text-[15px]">{repo.name}</span>
							<span class="ml-auto text-[13px] text-foreground-muted">{repo.provider}</span>
						</label>
					{/each}
				</div>
			</fieldset>

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

			<Collapsible.Root open={!!selected}>
				<Collapsible.Content>
					<form class="mt-6" onsubmit={fetchPr}>
				<fieldset>
					<legend class="text-[14px] font-medium">Pull request</legend>
					<div class="mt-2 flex items-end gap-2">
						<div class="min-w-0 flex-1">
							<Input
								placeholder="4127 or https://github.com/acme/ledger-api/pull/4127"
								aria-label="PR number or URL"
								bind:value={prInput}
								disabled={!selected}
								oninput={() => (prError = null)}
							/>
						</div>
						<Button
							type="submit"
							variant="outline"
							size="sm"
							class="h-[var(--size-control-md)] shrink-0 font-sans"
							loading={prState === 'loading'}
							disabled={!canFetch}
						>
							Fetch
						</Button>
					</div>
					<p class="mt-1.5 text-[13px] text-foreground-muted">
						Recoder reads the diff through the GitHub or GitLab CLI.
					</p>
					{#if prError}
						<p class="mt-1.5 text-[13px] font-medium text-error" role="alert">{prError}</p>
					{/if}
				</fieldset>
			</form>

			<div class="mt-4">
				<Collapsible.Root open={prState === 'loading' || prState === 'ready'}>
					<Collapsible.Content>
						{#if prState === 'loading'}
							<div class="rounded-xl border border-border bg-card p-5" role="status" aria-label="Fetching pull request">
								<div class="flex flex-col gap-2.5">
									<Skeleton class="h-6 w-1/3 rounded-lg" />
									<Skeleton class="h-4 w-2/3 rounded-md" />
									<div class="mt-2 flex items-center justify-between gap-2">
										<Skeleton class="h-4 w-32 rounded-md" />
										<Skeleton class="h-9 w-24 rounded-lg" />
									</div>
								</div>
							</div>
						{:else if prState === 'ready' && selected}
							<Card.Root>
								<Card.Header>
									<Card.Title>PR #{prNumber}</Card.Title>
									<Card.Description>
										{preview
											? `${preview.pr.title} · ${preview.pr.headRef} → ${preview.pr.base}`
											: 'Rate limit refactor · feat/rate-limit → main'}
									</Card.Description>
								</Card.Header>
								<Card.Footer class="items-center justify-between">
									<p class="m-0 font-mono text-[13px]">
										<span class="text-foreground">
											{fileTotals ? `${fileTotals.files} files` : '6 files'}
										</span>
										<span class="text-foreground-muted"> · </span>
										<span class="text-success">+{fileTotals ? fileTotals.additions : 89}</span>
										<span class="text-foreground-muted"> </span>
										<span class="text-error">−{fileTotals ? fileTotals.deletions : 34}</span>
									</p>
									<Button
										class="shrink-0 font-sans"
										status={requestStatus}
										loadingLabel="Queueing…"
										successLabel="Queued"
										onclick={() => void requestReview()}
									>
										Review
									</Button>
								</Card.Footer>
							</Card.Root>
						{/if}
					</Collapsible.Content>
				</Collapsible.Root>
			</div>
		</Collapsible.Content>
	</Collapsible.Root>
		</Collapsible.Content>
	</Collapsible.Root>

	<h2 class="mt-10 text-[14px] font-medium">Recent sessions</h2>
	<div class="mt-1 divide-y divide-border border-y border-border">
		{#each recent as session (session.id)}
			<button
				type="button"
				onclick={() =>
					openSession(
						session.id,
						session.repo,
						`#${session.pr}`,
						session.status === 'passed' || session.status === 'failed' ? 'ready' : 'reviewing'
					)}
				class="flex w-full items-center gap-2.5 bg-transparent px-1 py-2.5 text-left transition-colors hover:bg-secondary/60"
			>
				<span
					class="h-1.5 w-1.5 shrink-0 rounded-full"
					style:background-color={statusDot[session.status]}
				></span>
				<span class="font-mono text-[15px]">{session.repo}</span>
				<span class="font-mono text-[13px] text-foreground-muted">#{session.pr}</span>
				<span class="ml-auto text-[13px] text-foreground-muted">{session.status}</span>
			</button>
		{:else}
			<p class="px-1 py-3 text-[14px] text-foreground-muted">No sessions yet.</p>
		{/each}
	</div>
</div>
