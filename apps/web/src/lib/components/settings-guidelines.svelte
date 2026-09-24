<script lang="ts">
	import * as Alert from '@sivir-ui/svelte/components/alert';
	import { Badge } from '@sivir-ui/svelte/components/badge';
	import { Button } from '@sivir-ui/svelte/components/button';
	import * as Card from '@sivir-ui/svelte/components/card';
	import * as Typography from '@sivir-ui/svelte/components/typography';
	import ProviderMark from './provider-mark.svelte';
	import Skeleton from './ui/skeleton.svelte';
	import { firstRule, guidelinesStore } from '$lib/guidelines.svelte';

	/** Settings → Guidelines: the global layer, then each repo's `.recoder/REVIEW.md`. */
	const overview = $derived(guidelinesStore.overview);

	$effect(() => {
		void guidelinesStore.load().then((loaded) => {
			for (const repo of loaded?.repos ?? []) void guidelinesStore.loadRepo(repo.id);
		});
	});
</script>

<section class="settings-section" aria-labelledby="guidelines-global">
	<Typography.H3 id="guidelines-global" class="settings-label">Global</Typography.H3>
	{#if guidelinesStore.loadError && !overview}
		<Alert.Root variant="error">
			<Alert.Title>Could not load guidelines</Alert.Title>
			<Alert.Description>{guidelinesStore.loadError}</Alert.Description>
			<Button variant="outline" class="mt-2 w-fit" onclick={() => void guidelinesStore.load()}>Retry</Button>
		</Alert.Root>
	{:else}
		<Card.Root class="settings-list">
			<div class="settings-row">
				<div class="min-w-0 flex-1">
					<p class="settings-row-name">Every review</p>
					<p class="settings-row-desc guidelines-row-rule">
						{#if !overview}<Skeleton class="h-3 w-48" />
						{:else}{firstRule(overview.global.content) ?? 'Not set. Reviewers follow Recoder’s defaults.'}{/if}
					</p>
				</div>
				<Button variant="outline" disabled={!overview} onclick={() => guidelinesStore.open({ kind: 'global' })}>
					{firstRule(overview?.global.content) ? 'Edit' : 'Write'}
				</Button>
			</div>
		</Card.Root>
	{/if}
</section>

<section class="settings-section" aria-labelledby="guidelines-repos">
	<Typography.H3 id="guidelines-repos" class="settings-label">Repositories</Typography.H3>
	{#if !overview}
		<Card.Root class="settings-list">
			{#each [0, 1] as i (i)}
				<div class="settings-row"><Skeleton class="h-4 w-4 rounded" /><div class="flex-1"><Skeleton class="h-3.5 w-32" /></div><Skeleton class="h-7 w-16 rounded-md" /></div>
			{/each}
		</Card.Root>
	{:else if overview.repos.length === 0}
		<p class="settings-row-desc">Track a repository in Connections to give it its own guidelines.</p>
	{:else}
		<Card.Root class="settings-list">
			{#each overview.repos as repo, i (repo.id)}
				{@const state = guidelinesStore.repos[repo.id]}
				<div class="settings-row enter-rise" {...{ style: `--i: ${i}` }}>
					<span class="flex shrink-0 text-fg-secondary"><ProviderMark provider={repo.provider} size={16} /></span>
					<div class="min-w-0 flex-1">
						<p class="settings-row-name">{repo.name}</p>
						<p class="settings-row-desc guidelines-row-rule">
							{#if !state || state.status === 'loading'}<Skeleton class="h-3 w-40" />
							{:else if state.status === 'error'}<span class="text-danger" title={state.error}>{state.error}</span>
							{:else}{firstRule(state.data.pending?.content ?? state.data.content) ?? `No ${overview.path} yet`}{/if}
						</p>
					</div>
					{#if state?.status === 'ready'}
						{#if state.data.pending}
							<a href={state.data.pending.url} target="_blank" rel="noopener" class="guidelines-chip-link">
								<Badge variant="secondary" class="status-chip" data-tone="running">Pending in #{state.data.pending.number}</Badge>
							</a>
						{:else if state.data.content}
							<Badge variant="secondary" class="status-chip" data-tone="success" title="{state.data.ref} {state.data.sha ?? ''}">Active · {state.data.ref}</Badge>
						{/if}
					{/if}
					<Button variant="outline" disabled={state?.status === 'loading' || !state} onclick={() => guidelinesStore.open({ kind: 'repo', repoId: repo.id })}>
						{state?.status === 'ready' && (state.data.content || state.data.pending) ? 'Edit' : 'Write'}
					</Button>
				</div>
			{/each}
		</Card.Root>
	{/if}
</section>
