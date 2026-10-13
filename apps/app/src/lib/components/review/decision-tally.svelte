<script lang="ts">
	import type { ReviewState } from '$lib/review/review-state.svelte';

	interface Props {
		view: ReviewState;
	}

	let { view }: Props = $props();

	/** Past this many, pips stop reading as a count, so the tally becomes a bar split by outcome. */
	const MAX_PIPS = 12;

	const decisions = $derived(view.surface?.decisions ?? []);
	const pips = $derived(decisions.length <= MAX_PIPS);

	const share = (state: string) => decisions.filter((decision) => view.decisions.stateOf(decision.id) === state).length;
</script>

<span class="tally" aria-hidden="true">
	{#if pips}
		{#each decisions as decision (decision.id)}
			<span class="tally-pip" data-state={view.decisions.stateOf(decision.id)} data-tone={decision.tone}></span>
		{/each}
	{:else}
		<span class="tally-bar">
			{#each ['accepted', 'sent', 'dismissed', 'open'] as state (state)}
				<span class="tally-seg" data-state={state} style:flex-grow={share(state)}></span>
			{/each}
		</span>
	{/if}
</span>
