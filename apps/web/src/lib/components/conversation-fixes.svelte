<script lang="ts">
	import Check from '@lucide/svelte/icons/check';
	import * as AlertDialog from '@sivir-ui/svelte/components/alert-dialog';
	import { Button } from '@sivir-ui/svelte/components/button';
	import * as Card from '@sivir-ui/svelte/components/card';
	import { findingsStore, type Finding } from '$lib/findings.svelte';
	import { applyReadyFixes, hasReadyFix } from '$lib/fixes';
	import FindingSeverity from './finding-severity.svelte';
	import FixButton from './fix-button.svelte';
	import FixStatus from './fix-status.svelte';
	import SuggestedFix from './suggested-fix.svelte';
	import SeverityPill from './ui/severity-pill.svelte';

	/** The fixes a chat reply asked for, live: written, reviewed and applied right in the conversation. */
	let { ids }: { ids: string[] } = $props();
	const findings = $derived(ids.flatMap((id) => findingsStore.items.find((f) => f.id === id) ?? []));
	const writing = $derived(findings.filter((f) => findingsStore.suggestions[f.id]?.status === 'loading').length);
	const ready = $derived(findings.filter(hasReadyFix));
	const applying = $derived(findings.some((f) => findingsStore.suggestions[f.id]?.apply === 'applying'));
	let confirmOpen = $state(false);
	const count = (n: number) => `${n} ${n === 1 ? 'fix' : 'fixes'}`;
</script>

{#if findings.length}
	<section class="conversation-fixes" aria-label="Fixes">
		<header class="conversation-fixes-head">
			{#if writing}<span class="shimmer-text">Writing {count(writing)}…</span>
			{:else}<span>{count(findings.length)}</span>{/if}
			{#if ready.length > 1}
				<Button class="brief-action ms-auto" loading={applying} onclick={() => (confirmOpen = true)}>
					<Check size={13} aria-hidden="true" />Apply {count(ready.length)}
				</Button>
			{/if}
		</header>
		{#each findings as finding (finding.id)}
			{@const suggestion = findingsStore.suggestions[finding.id]}
			<Card.Root class="conversation-fix">
				<div class="conversation-fix-head">
					{#if finding.status === 'accepted'}<SeverityPill tone="success">Fixed</SeverityPill>{:else}<FindingSeverity severity={finding.severity} />{/if}
					<span class="conversation-fix-title">{finding.title}</span>
					<span class="conversation-fix-loc">{finding.file.split('/').at(-1)}:{finding.startLine}</span>
					{#if suggestion?.status === 'ready' || finding.status === 'accepted'}<FixButton {finding} variant="outline" class="ms-auto shrink-0" />{/if}
				</div>
				<FixStatus {finding} />
				{#if suggestion?.status === 'ready' && suggestion.patch}<SuggestedFix {suggestion} />{/if}
				{#if suggestion?.applyError}<p class="conversation-fix-error" role="status">{suggestion.applyError}</p>{/if}
			</Card.Root>
		{/each}
	</section>

	<AlertDialog.Root bind:open={confirmOpen}>
		<AlertDialog.Content>
			<AlertDialog.Header>
				<AlertDialog.Title>Apply {count(ready.length)}?</AlertDialog.Title>
				<AlertDialog.Description>Each fix is pushed as its own commit to the pull request branch.</AlertDialog.Description>
			</AlertDialog.Header>
			<AlertDialog.Footer>
				<AlertDialog.Exit>Cancel</AlertDialog.Exit>
				<AlertDialog.Confirm variant="primary" onclick={() => { confirmOpen = false; void applyReadyFixes(ready); }}>Apply {count(ready.length)}</AlertDialog.Confirm>
			</AlertDialog.Footer>
		</AlertDialog.Content>
	</AlertDialog.Root>
{/if}
