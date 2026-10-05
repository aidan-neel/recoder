<script lang="ts">
	import * as Card from '@sivir-ui/svelte/components/card';
	import { findingsStore } from '$lib/findings/findings.svelte';
	import FindingSeverity from './finding-severity.svelte';
	import FixStatus from './fix-status.svelte';
	import SuggestedFix from './suggested-fix.svelte';

	/** The fixes a chat reply asked for, live: each patch shows here as it's written, for the developer to apply. */
	let { ids }: { ids: string[] } = $props();
	const findings = $derived(ids.flatMap((id) => findingsStore.items.find((f) => f.id === id) ?? []));
	const writing = $derived(findings.filter((f) => findingsStore.suggestions[f.id]?.status === 'loading').length);
	const count = (n: number) => `${n} ${n === 1 ? 'fix' : 'fixes'}`;
</script>

{#if findings.length}
	<section class="conversation-fixes" aria-label="Fixes">
		<header class="conversation-fixes-head">
			{#if writing}<span class="shimmer-text">Writing {count(writing)}…</span>
			{:else}<span>{count(findings.length)}</span>{/if}
		</header>
		{#each findings as finding (finding.id)}
			{@const fix = findingsStore.readyFix(finding)}
			<Card.Root class="conversation-fix">
				<div class="conversation-fix-head">
					<FindingSeverity severity={finding.severity} />
					<span class="conversation-fix-title">{finding.title}</span>
					<span class="conversation-fix-loc">{finding.file.split('/').at(-1)}:{finding.startLine}</span>
				</div>
				<FixStatus {finding} />
				{#if fix}<SuggestedFix suggestion={fix} />{/if}
			</Card.Root>
		{/each}
	</section>
{/if}
