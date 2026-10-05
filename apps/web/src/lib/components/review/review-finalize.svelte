<script lang="ts">
	import {
		type CoverageSummary,
		type ReviewAssignment,
		type ReviewGuidelinesUsed,
		type ReviewReasoningEntry,
		type ReviewTask
	} from '@recoder/shared';
	import { Button } from '@sivir-ui/svelte/components/button';
	import * as Typography from '@sivir-ui/svelte/components/typography';
	import Disclosure from '../ui/disclosure.svelte';
	import ReasoningSteps from './reasoning-steps.svelte';
	import { finalFacts, verifyRow } from '$lib/review/reviewing-view';

	/**
	 * The review's closing step in the orchestrator's transcript: live verification while
	 * findings are checked, then the finalization thinking and a summary of facts.
	 */
	let {
		active,
		failed,
		stopped,
		reason,
		footerLabel,
		verifying,
		verifications,
		reasoning,
		finalReasoning,
		finalization,
		agents,
		finished,
		findingCount,
		coverage,
		guidelines,
		repoId,
		now
	}: {
		active: boolean;
		failed: boolean;
		/** The developer stopped it, so it reads as stopped rather than failed. */
		stopped: boolean;
		/** Why it failed, under the closing row. */
		reason: string | null;
		/** What the live review is doing, shown while it runs. */
		footerLabel: string;
		verifying: boolean;
		verifications: ReviewTask[];
		reasoning: ReviewReasoningEntry[];
		/** The orchestrator's thinking since finalization started. */
		finalReasoning: ReviewReasoningEntry[];
		finalization: ReviewTask | undefined;
		agents: ReviewAssignment[];
		finished: boolean;
		findingCount: number;
		coverage: CoverageSummary | null;
		guidelines: ReviewGuidelinesUsed | null;
		repoId: string | null;
		now: number;
	} = $props();

	const finalizationSeconds = $derived(
		finalization?.elapsedMs !== undefined ? Math.max(0, Math.round(finalization.elapsedMs / 1000)) : null
	);

	const facts = $derived(finalFacts({ agents, finished, findingCount, coverage, guidelines, repoId, finalization }));

	/** Verifiers have no thread of their own; here their thinking shows as one live step. */
	const verifyReasoning = $derived(verifying ? reasoning.filter((entry) => entry.role === 'verifier') : []);

	/** While it runs, only verification and the final thinking have something to open; waiting is just a spinner row. */
	const hasBody = $derived(
		verifying ? verifications.length > 0 : finalReasoning.length > 0 || (!active && facts.length > 0)
	);
</script>

{#snippet progressBody()}
	{#if verifying}
		<div class="fact-rows" aria-label="Findings being verified">
			{#each verifications as task (task.id)}
				{@const row = verifyRow(task, now)}
				<Typography.Text class="fact-row"
					><span class="fact-label">{row.state}</span><span class="fact-value" title={row.title}>{row.title}</span
					>{#if row.meta}<span class="fact-meta">{row.meta}</span>{/if}</Typography.Text
				>
			{/each}
		</div>
		<ReasoningSteps entries={verifyReasoning} live />
	{:else}
		<ReasoningSteps entries={finalReasoning} live={active} />
		{#if facts.length}
			<div class="fact-rows" aria-label="Finalization summary">
				{#each facts as fact (fact.label)}
					<Typography.Text class="fact-row"
						><span class="fact-label">{fact.label}</span>{#if fact.open}<Button
								unstyled
								class="fact-value fact-link"
								title="Edit these guidelines"
								onclick={fact.open}>{fact.value}</Button
							>{:else}<span class="fact-value" class:font-mono={fact.mono}>{fact.value}</span>{/if}{#if fact.meta}<span
								class="fact-meta">{fact.meta}</span
							>{/if}</Typography.Text
					>
				{/each}
			</div>
		{/if}
	{/if}
{/snippet}

<div class="finalize-row">
	<Disclosure
		status={active ? 'running' : stopped ? undefined : failed ? 'error' : 'done'}
		bodyClass="finalize-body"
		children={hasBody ? progressBody : undefined}
	>
		{#snippet label()}{active
				? footerLabel
				: stopped
					? 'Review stopped'
					: failed
						? 'Review failed'
						: `Finalized review${finalizationSeconds ? ` for ${finalizationSeconds}s` : ''}`}{/snippet}
	</Disclosure>
	{#if failed && !active && reason}
		<Typography.Text class="finalize-reason">{reason}</Typography.Text>
	{/if}
</div>
