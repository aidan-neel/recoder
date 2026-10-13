<script lang="ts">
	import ArrowUpRight from '@lucide/svelte/icons/arrow-up-right';
	import { Button } from '@sivir-ui/svelte/components/button';
	import Keycap from '../ui/keycap.svelte';
	import type { ReviewState } from '$lib/review/review-state.svelte';
	import { plural } from '$lib/shell/format';

	interface Props {
		view: ReviewState;
	}

	let { view }: Props = $props();

	const total = $derived(view.surface?.decisions.length ?? 0);
	const accepted = $derived(total - view.sent.length);
	const prUrl = $derived(view.review?.prUrl ?? view.pull?.url ?? null);
</script>

<section class="verdict" data-sent={view.sent.length > 0} aria-labelledby="verdict-title">
	<h2 class="verdict-title" id="verdict-title">
		{#if total === 0}
			Nothing needs a decision.
			<span class="verdict-rest">The reviewers found no problems worth your time.</span>
		{:else if view.sent.length > 0}
			{plural(view.sent.length, 'item')} go{view.sent.length === 1 ? 'es' : ''} back to the agent.
			<span class="verdict-rest">{accepted > 0 ? `${accepted} accepted as is.` : 'Nothing accepted as is.'}</span>
		{:else}
			Every decision is made.
			<span class="verdict-rest">Nothing goes back to the agent.</span>
		{/if}
	</h2>
	<div class="verdict-actions">
		{#if view.sent.length > 0}
			<Button onclick={() => (view.handoffOpen = true)}>Hand off to the agent <Keycap key="h" /></Button>
		{:else if prUrl}
			<Button href={prUrl} target="_blank" rel="noreferrer"
				>Approve on GitHub <ArrowUpRight size={14} aria-hidden="true" /></Button
			>
		{/if}
		{#if view.sent.length > 0 && prUrl}
			<Button variant="ghost" href={prUrl} target="_blank" rel="noreferrer"
				>Open pull request <ArrowUpRight size={14} aria-hidden="true" /></Button
			>
		{/if}
	</div>
</section>
