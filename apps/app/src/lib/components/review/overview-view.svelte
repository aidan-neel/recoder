<script lang="ts">
	import Check from '@lucide/svelte/icons/check';
	import { Button } from '@sivir-ui/svelte/components/button';
	import ChangeMap from './change-map.svelte';
	import CiChecks from './ci-checks.svelte';
	import Verdict from './verdict.svelte';
	import Keycap from '../ui/keycap.svelte';
	import RichText from '../ui/rich-text.svelte';
	import type { ReviewState } from '$lib/review/review-state.svelte';
	import { plural } from '$lib/shell/format';

	interface Props {
		view: ReviewState;
	}

	let { view }: Props = $props();

	const surface = $derived(view.surface!);
	const reproduced = $derived(surface.decisions.filter((decision) => decision.proof === 'reproduced').length);
	const ran = $derived(surface.receipts.filter((receipt) => receipt.evidence?.command).length);
	const allDecided = $derived(surface.decisions.length > 0 && view.open.length === 0);
	const nothingFound = $derived(surface.decisions.length === 0);
</script>

<div class="overview">
	{#if surface.intent}
		<p class="overview-intent ai-voice"><RichText text={surface.intent} /></p>
	{/if}

	<section class="overview-block" aria-labelledby="overview-lead">
		<h2 class="overview-lead" id="overview-lead">
			{#if surface.attention.read === 0}
				Nothing left to read.
				<span class="overview-lead-rest"
					>All {surface.attention.total} changed lines are checked, tests or mechanical.</span
				>
			{:else}
				{surface.attention.read} of {surface.attention.total} changed lines need your eyes.
				<span class="overview-lead-rest">About {surface.minutes} min.</span>
			{/if}
		</h2>
		<ChangeMap attention={surface.attention} />
	</section>

	{#if allDecided || nothingFound}
		<Verdict {view} />
	{:else}
		<div class="overview-start">
			<Button onclick={() => view.select(view.nextOpen(null))}>
				Start with the riskiest <Keycap key="Enter" />
			</Button>
			<span class="overview-start-note"
				>{plural(view.open.length, 'decision')} left{reproduced
					? `, ${reproduced} reproduced by running code`
					: ''}.</span
			>
		</div>
	{/if}

	{#if surface.receipts.length || view.checks?.length}
		<section class="overview-block" aria-labelledby="overview-checked">
			<h2 class="overview-section-title" id="overview-checked">
				Checked for you<span class="tabular">{surface.receipts.length}</span>
				{#if ran}<span class="overview-section-note">{ran} by running code</span>{/if}
			</h2>
			{#if view.checks?.length}<CiChecks checks={view.checks} />{/if}
			<ul class="receipt-list">
				{#each surface.receipts as receipt (receipt.id)}
					<li>
						<button class="receipt-line" type="button" onclick={() => view.select({ kind: 'receipt', id: receipt.id })}>
							<span class="receipt-check" aria-hidden="true"><Check size={11} strokeWidth={2.5} /></span>
							<span class="receipt-q"><RichText text={receipt.question} /></span>
						</button>
					</li>
				{/each}
			</ul>
		</section>
	{/if}
</div>
