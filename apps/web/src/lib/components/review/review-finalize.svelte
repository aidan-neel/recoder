<script lang="ts">
	import {
		ORCHESTRATOR_ID,
		type CoverageSummary,
		type ReviewAssignment,
		type ReviewGuidelinesUsed,
		type ReviewReasoningEntry,
		type ReviewTask
	} from '@recoder/shared';
	import Play from '@lucide/svelte/icons/play';
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
		footerLabel,
		verifying,
		verifications,
		reasoning,
		finalReasoning,
		finalization,
		specialists,
		finished,
		findingCount,
		coverage,
		guidelines,
		repoId,
		now,
		continuing,
		onContinue
	}: {
		active: boolean;
		failed: boolean;
		/** What the live review is doing, shown while it runs. */
		footerLabel: string;
		verifying: boolean;
		verifications: ReviewTask[];
		reasoning: ReviewReasoningEntry[];
		/** The orchestrator's thinking since finalization started. */
		finalReasoning: ReviewReasoningEntry[];
		finalization: ReviewTask | undefined;
		specialists: ReviewAssignment[];
		finished: boolean;
		findingCount: number;
		coverage: CoverageSummary | null;
		guidelines: ReviewGuidelinesUsed | null;
		repoId: string | null;
		now: number;
		continuing: boolean;
		/** Continue a failed review from where it stopped. */
		onContinue: (() => void) | null;
	} = $props();

	const finalizationSeconds = $derived(
		finalization?.elapsedMs !== undefined ? Math.max(0, Math.round(finalization.elapsedMs / 1000)) : null
	);

	const facts = $derived(
		finalFacts({ specialists, finished, findingCount, coverage, guidelines, repoId, finalization })
	);

	const verifyStartedAt = $derived(
		verifications
			.map((task) => task.startedAt)
			.filter((at): at is string => !!at)
			.sort()[0]
	);

	/** Verifiers work in the threads of the specialists whose findings they check; here their thinking shows as one live step. */
	const verifyReasoning = $derived(
		verifying && verifyStartedAt
			? reasoning.filter(
					(entry) =>
						(entry.assignmentId ?? ORCHESTRATOR_ID) !== ORCHESTRATOR_ID &&
						Date.parse(entry.at) >= Date.parse(verifyStartedAt)
				)
			: []
	);

	const hasBody = $derived(verifying ? verifications.length > 0 : finalReasoning.length > 0 || facts.length > 0);
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

<Disclosure
	status={active ? 'running' : failed ? 'error' : 'done'}
	bodyClass="finalize-body"
	children={hasBody ? progressBody : undefined}
>
	{#snippet label()}{active
			? footerLabel
			: failed
				? 'Review failed'
				: `Finalized review${finalizationSeconds ? ` for ${finalizationSeconds}s` : ''}`}{/snippet}
</Disclosure>
{#if failed && !active && onContinue}
	<div class="review-start-cta">
		<Button class="brief-action" loading={continuing} onclick={onContinue}>
			<Play size={12} fill="currentColor" aria-hidden="true" /> Continue review
		</Button>
	</div>
{/if}
