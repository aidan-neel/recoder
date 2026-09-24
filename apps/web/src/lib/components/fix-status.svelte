<script lang="ts">
	import { Spinner } from '@sivir-ui/svelte/components/spinner';
	import { findingsStore, type Finding } from '$lib/findings.svelte';
	import { suggestFix } from '$lib/fixes';
	import { formatAgentName } from '$lib/threads.svelte';

	/** While a finding's specialist writes its fix, or when that failed. The ready fix renders as SuggestedFix. */
	let { finding }: { finding: Finding } = $props();
	const suggestion = $derived(findingsStore.suggestions[finding.id]);
</script>

{#if suggestion?.status === 'loading'}
	<p class="fix-status" role="status">
		<Spinner size={12} aria-hidden="true" />
		<span class="shimmer-text">{formatAgentName(finding.agent)} is writing a fix…</span>
	</p>
{:else if suggestion?.status === 'error'}
	<p class="fix-status" data-error role="status">
		Couldn't write a fix{suggestion.error ? `: ${suggestion.error}` : '.'}
		<button type="button" class="fix-status-retry" onclick={() => void suggestFix(finding)}>Try again</button>
	</p>
{/if}
