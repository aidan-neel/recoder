<script lang="ts">
	import { onMount, untrack as untracked } from 'svelte';
	import Check from '@lucide/svelte/icons/check';
	import Plus from '@lucide/svelte/icons/plus';
	import Search from '@lucide/svelte/icons/search';
	import X from '@lucide/svelte/icons/x';
	import * as Alert from '@sivir-ui/svelte/components/alert';
	import { Badge } from '@sivir-ui/svelte/components/badge';
	import { Button } from '@sivir-ui/svelte/components/button';
	import * as Card from '@sivir-ui/svelte/components/card';
	import { Input } from '@sivir-ui/svelte/components/input';
	import * as Modal from '@sivir-ui/svelte/components/modal';
	import { ScrollArea } from '@sivir-ui/svelte/components/scroll-area';
	import { Spinner } from '@sivir-ui/svelte/components/spinner';
	import * as Typography from '@sivir-ui/svelte/components/typography';
	import type { Provider, ProviderAuth, RemoteRepo, Repo } from '@recoder/shared';
	import ProviderMark from './provider-mark.svelte';
	import Skeleton from './ui/skeleton.svelte';
	import { modelSettingsUi } from '$lib/model-settings.svelte';
	import { errorToast, undoToast } from '$lib/notify';
	import { openPrs } from '$lib/open-prs.svelte';
	import { serverApi } from '$lib/server-api';
	import { shellState } from '$lib/shell-state.svelte';

	const PROVIDERS: { id: Provider; label: string; scope: string }[] = [
		{ id: 'github', label: 'GitHub', scope: 'Needs the repo scope.' },
		{ id: 'gitlab', label: 'GitLab', scope: 'Needs read_api and read_repository. Leave the URL blank for gitlab.com.' }
	];

	let auth = $state<{ github: ProviderAuth; gitlab: ProviderAuth } | null>(null);
	let authError = $state<string | null>(null);
	let connecting = $state<Provider | null>(null);
	let tokenOpen = $state(false);
	let token = $state('');
	/** Self-managed GitLab host; blank means gitlab.com. */
	let gitlabHost = $state('');
	let tokenSaving = $state(false);
	let tokenError = $state<string | null>(null);
	let disconnecting = $state<Provider | null>(null);

	let browseOpen = $state(false);
	let remote = $state<RemoteRepo[]>([]);
	let remoteQuery = $state('');
	let remoteLoading = $state(false);
	let remoteError = $state<string | null>(null);
	let trackingUrl = $state<string | null>(null);
	let untracking = $state<string | null>(null);

	onMount(() => {
		void loadAuth();
		void openPrs.load();
	});

	/** Home's setup checklist opens Settings straight into a dialog. */
	$effect(() => {
		const intent = modelSettingsUi.intent;
		if (!intent) return;
		untracked(() => {
			modelSettingsUi.intent = null;
			if (intent.kind === 'connect') openToken(intent.provider);
			else void openBrowse();
		});
	});

	async function loadAuth(): Promise<void> {
		authError = null;
		try {
			auth = await serverApi.authStatus();
		} catch (e) {
			authError = e instanceof Error ? e.message : 'Could not check connections.';
		}
	}

	function openToken(provider: Provider): void {
		connecting = provider;
		token = '';
		gitlabHost = auth?.gitlab.host ?? '';
		tokenError = null;
		tokenOpen = true;
	}

	async function saveToken(event: SubmitEvent): Promise<void> {
		event.preventDefault();
		if (!connecting || !token.trim() || tokenSaving) return;
		tokenSaving = true;
		tokenError = null;
		try {
			await serverApi.saveToken(connecting, token.trim(), connecting === 'gitlab' ? gitlabHost.trim() : undefined);
			tokenOpen = false;
			token = '';
			await loadAuth();
			shellState.load();
		} catch (e) {
			tokenError = e instanceof Error ? e.message : 'Token rejected.';
		} finally {
			tokenSaving = false;
		}
	}

	async function disconnect(provider: Provider): Promise<void> {
		disconnecting = provider;
		try {
			await serverApi.clearToken(provider);
			await loadAuth();
			shellState.load();
		} catch (e) {
			errorToast('Could not disconnect', e instanceof Error ? e.message : undefined);
		} finally {
			disconnecting = null;
		}
	}

	const trackedUrls = $derived(new Set(openPrs.repos.map((repo) => repo.url.replace(/\/$/, ''))));
	const filteredRemote = $derived.by(() => {
		const q = remoteQuery.trim().toLowerCase();
		return q === '' ? remote : remote.filter((repo) => repo.name.toLowerCase().includes(q));
	});

	async function openBrowse(): Promise<void> {
		browseOpen = true;
		remoteQuery = '';
		if (remote.length > 0 || remoteLoading) return;
		remoteLoading = true;
		remoteError = null;
		try {
			const status = auth ?? (await serverApi.authStatus());
			const providers = PROVIDERS.map((p) => p.id).filter((id) => status[id].authenticated);
			remote = (await Promise.all(providers.map((id) => serverApi.remoteRepos(id)))).flat();
		} catch (e) {
			remoteError = e instanceof Error ? e.message : 'Could not list repositories.';
		} finally {
			remoteLoading = false;
		}
	}

	async function track(repo: RemoteRepo): Promise<void> {
		trackingUrl = repo.url;
		try {
			openPrs.track(await serverApi.createRepo({ name: repo.name, url: repo.url, provider: repo.provider }));
		} catch (e) {
			errorToast('Could not track the repository', e instanceof Error ? e.message : undefined);
		} finally {
			trackingUrl = null;
		}
	}

	async function untrack(repo: Repo): Promise<void> {
		untracking = repo.id;
		try {
			await serverApi.deleteRepo(repo.id);
			openPrs.untrack(repo.id);
			undoToast(`Stopped tracking ${repo.name}`, () => {
				void serverApi
					.createRepo({ name: repo.name, url: repo.url, provider: repo.provider, defaultBranch: repo.defaultBranch })
					.then((restored) => openPrs.track(restored));
			});
		} catch (e) {
			errorToast('Could not stop tracking', e instanceof Error ? e.message : undefined);
		} finally {
			untracking = null;
		}
	}
</script>

<section class="settings-section" aria-labelledby="conn-providers">
	<Typography.H3 id="conn-providers" class="settings-label">Git providers</Typography.H3>
	{#if authError}
		<Alert.Root variant="error">
			<Alert.Title>Could not check connections</Alert.Title>
			<Alert.Description>{authError}</Alert.Description>
			<Button variant="outline" class="mt-2 w-fit" onclick={() => void loadAuth()}>Retry</Button>
		</Alert.Root>
	{:else}
		<Card.Root class="settings-list">
			{#each PROVIDERS as provider (provider.id)}
				{@const state = auth?.[provider.id]}
				<div class="settings-row">
					<span class="flex shrink-0 text-fg-secondary"><ProviderMark provider={provider.id} size={16} /></span>
					<div class="min-w-0 flex-1">
						<p class="settings-row-name">{provider.label}</p>
						<p class="settings-row-desc">
							{#if !state}Checking…
							{:else if state.authenticated}Signed in as <span class="font-mono">{state.user}</span>{#if state.host}<span> on </span><span class="font-mono">{state.host}</span>{/if}
							{:else if !state.available}CLI not installed. Connect with a token instead.
							{:else}Not connected{/if}
						</p>
					</div>
					{#if !state}
						<Skeleton class="h-7 w-20 rounded-md" />
					{:else if state.authenticated}
						<Button
							variant="ghost"
							class="provider-link"
							loading={disconnecting === provider.id}
							onclick={() => void disconnect(provider.id)}
						>
							Disconnect
						</Button>
					{:else}
						<Button variant="outline" onclick={() => openToken(provider.id)}>Connect</Button>
					{/if}
				</div>
			{/each}
		</Card.Root>
	{/if}
</section>

<section class="settings-section" aria-labelledby="conn-repos">
	<div class="flex items-baseline justify-between gap-3">
		<Typography.H3 id="conn-repos" class="settings-label">Tracked repositories</Typography.H3>
		<Button variant="ghost" class="provider-link" onclick={() => void openBrowse()}>
			<Plus size={13} aria-hidden="true" /> Track a repository
		</Button>
	</div>
	{#if openPrs.loading}
		<Card.Root class="settings-list">
			{#each [0, 1] as i (i)}
				<div class="settings-row"><Skeleton class="h-4 w-1/2" /></div>
			{/each}
		</Card.Root>
	{:else if openPrs.repos.length === 0}
		<p class="settings-empty">No repositories tracked yet.</p>
	{:else}
		<Card.Root class="settings-list">
			{#each openPrs.repos as repo, i (repo.id)}
				<div class="settings-row enter-rise" style:--i={i}>
					<span class="flex shrink-0 text-fg-subtle"><ProviderMark provider={repo.provider} size={14} /></span>
					<span class="min-w-0 flex-1 truncate font-mono text-[12.5px]">{repo.name}</span>
					<span class="shrink-0 font-mono text-[11.5px] text-fg-faint">{openPrs.prsByRepo[repo.id]?.length ?? '–'} open</span>
					<Button
						variant="ghost"
						size="icon"
						aria-label="Stop tracking {repo.name}"
						disabled={untracking === repo.id}
						onclick={() => void untrack(repo)}
					>
						{#if untracking === repo.id}<Spinner size={13} />{:else}<X size={14} aria-hidden="true" />{/if}
					</Button>
				</div>
			{/each}
		</Card.Root>
	{/if}
</section>

<Modal.Root bind:open={tokenOpen}>
	<Modal.Content size="sm">
		<Modal.Header>
			<Modal.Title>Connect {PROVIDERS.find((p) => p.id === connecting)?.label}</Modal.Title>
		</Modal.Header>
		<Modal.Body>
			<form id="connect-provider" class="grid gap-3" onsubmit={saveToken}>
				{#if connecting === 'gitlab'}
					<Input
						label="GitLab URL"
						autocomplete="off"
						spellcheck={false}
						placeholder="gitlab.com"
						bind:value={gitlabHost}
					/>
				{/if}
				<Input
					type="password"
					label="Personal access token"
					autocomplete="off"
					placeholder={connecting === 'gitlab' ? 'glpat-…' : 'ghp_… or github_pat_…'}
					bind:value={token}
				/>
				<Typography.Text variant="supporting" class="text-[12.5px]">
					{PROVIDERS.find((p) => p.id === connecting)?.scope} Kept in server memory only.
				</Typography.Text>
				{#if tokenError}<p class="m-0 text-[12.5px] text-danger" role="alert">{tokenError}</p>{/if}
			</form>
		</Modal.Body>
		<Modal.Footer>
			<Modal.Close>Cancel</Modal.Close>
			<Button type="submit" form="connect-provider" loading={tokenSaving} disabled={!token.trim()}>Connect</Button>
		</Modal.Footer>
	</Modal.Content>
</Modal.Root>

<Modal.Root bind:open={browseOpen}>
	<Modal.Content size="lg">
		<Modal.Header><Modal.Title>Track a repository</Modal.Title></Modal.Header>
		<Modal.Body>
			{#if remoteLoading}
				<div class="flex flex-col gap-2" role="status" aria-label="Listing repositories">
					{#each [0, 1, 2, 3] as i (i)}<Skeleton class="h-10 w-full rounded-lg" />{/each}
				</div>
			{:else if remoteError}
				<Alert.Root variant="error">
					<Alert.Title>Could not list repositories</Alert.Title>
					<Alert.Description>{remoteError}</Alert.Description>
				</Alert.Root>
			{:else if remote.length === 0}
				<Typography.Text variant="supporting">Connect GitHub or GitLab to browse your repositories.</Typography.Text>
			{:else}
				<div class="flex flex-col gap-3">
					<Input placeholder="Search repositories" aria-label="Search repositories" bind:value={remoteQuery}>
						{#snippet leading()}<Search size={15} aria-hidden="true" />{/snippet}
					</Input>
					<ScrollArea aria-label="Your repositories" class="max-h-[56dvh]" showCues={false}>
						<ul class="m-0 flex list-none flex-col p-0">
							{#each filteredRemote as repo (repo.url)}
								{@const tracked = trackedUrls.has(repo.url.replace(/\/$/, ''))}
								<li class="flex items-center gap-3 border-b border-line-subtle py-2">
									<span class="flex shrink-0 text-fg-subtle"><ProviderMark provider={repo.provider} size={14} /></span>
									<span class="min-w-0 flex-1 truncate font-mono text-[12.5px]">{repo.name}</span>
									{#if repo.isPrivate}<Badge variant="secondary" class="status-chip">private</Badge>{/if}
									{#if tracked}
										<Button variant="ghost" size="icon" disabled aria-label="{repo.name} is tracked" class="text-ok disabled:opacity-100">
											<Check size={15} aria-hidden="true" />
										</Button>
									{:else}
										<Button
											variant="outline"
											size="icon"
											aria-label="Track {repo.name}"
											disabled={trackingUrl === repo.url}
											onclick={() => void track(repo)}
										>
											{#if trackingUrl === repo.url}<Spinner size={14} />{:else}<Plus size={15} aria-hidden="true" />{/if}
										</Button>
									{/if}
								</li>
							{:else}
								<li class="py-3 text-[13px] text-fg-faint">No repositories match “{remoteQuery.trim()}”.</li>
							{/each}
						</ul>
					</ScrollArea>
				</div>
			{/if}
		</Modal.Body>
	</Modal.Content>
</Modal.Root>
