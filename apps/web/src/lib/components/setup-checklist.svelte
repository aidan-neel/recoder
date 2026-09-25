<script lang="ts">
	import Check from '@lucide/svelte/icons/check';
	import Plus from '@lucide/svelte/icons/plus';
	import { Button } from '@sivir-ui/svelte/components/button';
	import * as Card from '@sivir-ui/svelte/components/card';
	import * as Typography from '@sivir-ui/svelte/components/typography';
	import type { ProviderAuth } from '@recoder/shared';
	import ProviderMark from './provider-mark.svelte';
	import { modelSettingsUi } from '$lib/model-settings.svelte';

	/** First run (4d): what still stands between the user and a review. */
	let {
		auth,
		repoCount
	}: {
		auth: { github: ProviderAuth; gitlab: ProviderAuth };
		repoCount: number;
	} = $props();

	type StepId = 'provider' | 'model' | 'repo';

	const signedIn = $derived(auth.github.authenticated ? auth.github : auth.gitlab.authenticated ? auth.gitlab : null);
	// Public repos work without a token, so a tracked repo counts as connected.
	const done = $derived<Record<StepId, boolean>>({
		provider: !!signedIn || repoCount > 0,
		model: !!modelSettingsUi.config?.configured,
		repo: repoCount > 0
	});
	const order: StepId[] = ['provider', 'model', 'repo'];
	const current = $derived(order.find((id) => !done[id]) ?? null);
	const remaining = $derived(order.filter((id) => !done[id]).length);
	const COUNT_WORDS = ['No steps', 'One step', 'Two steps', 'Three steps'];

	function state(id: StepId): 'done' | 'current' | 'pending' {
		return done[id] ? 'done' : id === current ? 'current' : 'pending';
	}
</script>

{#snippet marker(id: StepId, n: number)}
	{#if done[id]}
		<span class="setup-marker" data-state="done"><Check size={12} strokeWidth={2.25} aria-hidden="true" /></span>
	{:else}
		<span class="setup-marker" data-state={state(id)} aria-hidden="true">{n}</span>
	{/if}
{/snippet}

<section class="setup" aria-labelledby="setup-title">
	<Typography.Text id="setup-title" class="setup-headline">
		<span class="text-fg">{COUNT_WORDS[remaining]} before your first review.</span>
		Everything runs on this machine; code never leaves the sandbox checkout.
	</Typography.Text>

	<Card.Root class="setup-card">
		<ol class="contents">
			<li class="setup-step" data-state={state('provider')}>
				{@render marker('provider', 1)}
				<div class="setup-step-body">
					<div class="setup-step-text">
						<span class="setup-step-title">{signedIn ? `Connect ${signedIn.provider === 'gitlab' ? 'GitLab' : 'GitHub'}` : 'Connect GitHub or GitLab'}</span>
						<span class="setup-step-desc">
							{#if signedIn}
								Signed in as <span class="font-mono">{signedIn.user}</span>{#if signedIn.host}<span> on </span><span class="font-mono">{signedIn.host}</span>{/if}
							{:else if done.provider}
								Reading public repositories without a token
							{:else}
								Recoder lists pull requests and checks out code with your account. A signed-in <span class="font-mono">gh</span> or <span class="font-mono">glab</span> CLI is picked up automatically.
							{/if}
						</span>
					</div>
					{#if current === 'provider'}
						<div class="setup-actions">
							<Button class="setup-action" onclick={() => modelSettingsUi.show('connections', { kind: 'connect', provider: 'github' })}>
								<ProviderMark provider="github" size={14} /> Connect GitHub
							</Button>
							<Button variant="outline" class="setup-action" onclick={() => modelSettingsUi.show('connections', { kind: 'connect', provider: 'gitlab' })}>
								<ProviderMark provider="gitlab" size={14} /> Connect GitLab
							</Button>
						</div>
					{/if}
				</div>
				{#if signedIn}
					<span class="flex shrink-0 self-center text-fg-faint"><ProviderMark provider={signedIn.provider} size={16} /></span>
				{/if}
			</li>

			<li class="setup-step" data-state={state('model')}>
				{@render marker('model', 2)}
				<div class="setup-step-body">
					<div class="setup-step-text">
						<span class="setup-step-title">Add a reviewer model</span>
						<span class="setup-step-desc">
							{#if done.model}
								{@const choice = modelSettingsUi.orchestrator}
								{@const model = modelSettingsUi.models.find((item) => item.id === choice?.modelId)}
								{model ? `Orchestrator runs on ${model.displayName}` : 'Configured'}
							{:else}
								Reviews won't start without one. Use your ChatGPT plan, or any OpenAI-compatible endpoint.
							{/if}
						</span>
					</div>
					{#if current === 'model'}
						<div class="setup-actions">
							<Button class="setup-action" onclick={() => modelSettingsUi.show('models')}>Sign in with ChatGPT</Button>
							<Button variant="outline" class="setup-action" onclick={() => modelSettingsUi.show('models')}>Use an API endpoint</Button>
						</div>
					{/if}
				</div>
				{#if state('model') === 'pending'}
					<Button variant="outline" class="setup-pending-action" onclick={() => modelSettingsUi.show('models')}>Add model</Button>
				{/if}
			</li>

			<li class="setup-step" data-state={state('repo')}>
				{@render marker('repo', 3)}
				<div class="setup-step-body">
					<div class="setup-step-text">
						<span class="setup-step-title">Track a repository</span>
						<span class="setup-step-desc">
							{done.repo ? `Tracking ${repoCount} ${repoCount === 1 ? 'repository' : 'repositories'}` : 'Its open pull requests show up on Home'}
						</span>
					</div>
					{#if current === 'repo'}
						<div class="setup-actions">
							<Button class="setup-action" onclick={() => modelSettingsUi.show('connections', { kind: 'browse-repos' })}>
								<Plus size={14} aria-hidden="true" /> Browse repos
							</Button>
						</div>
					{/if}
				</div>
				{#if state('repo') === 'pending'}
					<Button
						variant="outline"
						class="setup-pending-action"
						disabled={!done.provider}
						title={done.provider ? undefined : 'Connect GitHub or GitLab first'}
						onclick={() => modelSettingsUi.show('connections', { kind: 'browse-repos' })}
					>
						<Plus size={12} aria-hidden="true" /> Browse repos
					</Button>
				{/if}
			</li>
		</ol>
	</Card.Root>
</section>
