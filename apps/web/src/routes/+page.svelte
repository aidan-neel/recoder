<script lang="ts">
	import { goto } from '$app/navigation';
	import { Button, type ButtonStatus } from '@sivir-ui/svelte/components/button';
	import * as Card from '@sivir-ui/svelte/components/card';
	import { Badge, type BadgeVariant } from '@sivir-ui/svelte/components/badge';
	import { Input } from '@sivir-ui/svelte/components/input';
	import { sessionState } from '$lib/session-state.svelte';

	interface RepoOption {
		id: string;
		name: string;
		connected: boolean;
	}

	interface RecentSession {
		id: string;
		repo: string;
		pr: number;
		status: 'passed' | 'running' | 'queued';
	}

	const repos: RepoOption[] = [
		{ id: 'ledger-api', name: 'acme/ledger-api', connected: true },
		{ id: 'gateway', name: 'acme/gateway', connected: true },
		{ id: 'infra', name: 'infra/local', connected: false }
	];

	const recent: RecentSession[] = [
		{ id: 'ledger-api', repo: 'ledger-api', pr: 4127, status: 'passed' },
		{ id: 'gateway', repo: 'gateway', pr: 902, status: 'running' },
		{ id: 'console', repo: 'console', pr: 3310, status: 'queued' }
	];

	const statusVariant: Record<RecentSession['status'], BadgeVariant> = {
		passed: 'success',
		running: 'info',
		queued: 'secondary'
	};

	let selectedRepo = $state<string | null>(null);
	let prInput = $state('');
	let prState = $state<'idle' | 'loading' | 'ready'>('idle');
	let prError = $state<string | null>(null);
	let prNumber = $state(0);
	let requestStatus = $state<ButtonStatus>('idle');

	const selected = $derived(repos.find((r) => r.id === selectedRepo));

	function selectRepo(id: string): void {
		selectedRepo = id;
		prState = 'idle';
		prError = null;
	}

	async function fetchPr(event: SubmitEvent): Promise<void> {
		event.preventDefault();
		prError = null;
		if (!selected) {
			prError = 'Choose a repository first.';
			return;
		}
		const digits = prInput.replace(/\D/g, '');
		if (digits === '') {
			prError = 'Enter a PR number or paste a pull request URL.';
			return;
		}
		prState = 'loading';
		await new Promise((r) => setTimeout(r, 600));
		prNumber = Number.parseInt(digits, 10);
		prState = 'ready';
	}

	async function requestReview(): Promise<void> {
		if (requestStatus === 'loading' || !selected) return;
		requestStatus = 'loading';
		// Backend plugs in here: POST /api/reviews, then stream subagent progress.
		await new Promise((r) => setTimeout(r, 900));
		requestStatus = 'success';
		const session = sessionState.restartReview(
			selected.id,
			selected.name,
			`#${prNumber}`
		);
		await new Promise((r) => setTimeout(r, 350));
		await goto(`/session/${session.id}`);
	}
</script>

<div class="mx-auto flex min-h-[calc(100vh-8rem)] w-full max-w-xl flex-col justify-center px-4 py-10">
	<h1 class="text-2xl font-semibold tracking-tight">Start a review</h1>

	<fieldset class="mt-8">
		<legend class="text-[14px] font-medium">Repository</legend>
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
					<span
						class="h-1.5 w-1.5 shrink-0 rounded-full"
						style:background-color={repo.connected ? '#3fb96c' : '#8a8f98'}
					></span>
					<span class="font-mono text-[15px]">{repo.name}</span>
					<span class="ml-auto text-[13px] text-foreground-muted">
						{repo.connected ? 'Connected' : 'Not connected'}
					</span>
				</label>
			{/each}
		</div>
	</fieldset>

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
					variant="primary"
					size="sm"
					class="h-[var(--size-control-md)] shrink-0 font-sans"
					loading={prState === 'loading'}
					disabled={!selected}
				>
					Fetch
				</Button>
			</div>
			{#if prError}
				<p class="mt-1.5 text-[13px] font-medium text-error" role="alert">{prError}</p>
			{/if}
		</fieldset>
	</form>

	{#if prState === 'ready' && selected}
		<Card.Root class="mt-4">
			<Card.Header>
				<Card.Title>PR #{prNumber}</Card.Title>
				<Card.Description>Rate limit refactor · feat/rate-limit → main</Card.Description>
			</Card.Header>
			<Card.Footer class="items-center justify-between">
				<p class="m-0 font-mono text-[13px]">
					<span class="text-foreground">6 files</span>
					<span class="text-foreground-muted"> · </span>
					<span class="text-success">+89</span>
					<span class="text-foreground-muted"> </span>
					<span class="text-error">−34</span>
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

	<h2 class="mt-10 text-[14px] font-medium">Recent sessions</h2>
	<div class="mt-3 grid gap-2">
		{#each recent as session (session.id)}
			<a
				href={`/session/${session.id}`}
				class="block rounded-[var(--radius-lg)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
			>
				<Card.Root class="p-0 transition-colors hover:border-foreground/20">
					<div class="flex items-center gap-2.5 px-3 py-2.5">
						<span class="font-mono text-[15px]">{session.repo}</span>
						<span class="font-mono text-[13px] text-foreground-muted">#{session.pr}</span>
						<Badge
							variant={statusVariant[session.status]}
							dot
							class="ml-auto font-sans capitalize"
						>
							{session.status}
						</Badge>
					</div>
				</Card.Root>
			</a>
		{/each}
	</div>
</div>
