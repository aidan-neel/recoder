<script lang="ts">
	import Wrench from '@lucide/svelte/icons/wrench';
	import { Button } from '@sivir-ui/svelte/components/button';
	import { findingsStore, type Finding } from '$lib/findings/findings.svelte';
	import { suggestFix } from '$lib/findings/fixes';
	import { threadsStore } from '$lib/findings/threads.svelte';

	/** Asks the finding's reviewer for a patch. Gone once one is ready, since the patch shows on the finding. */
	let { finding }: { finding: Finding } = $props();
	const suggestion = $derived(findingsStore.suggestions[finding.id]);
</script>

{#if !(suggestion?.status === 'ready' && suggestion.patch)}
	<Button
		class="fix-button"
		disabled={!threadsStore.reviewId}
		loading={suggestion?.status === 'loading'}
		onclick={() => void suggestFix(finding)}
	>
		<Wrench size={14} aria-hidden="true" />Suggest fix
	</Button>
{/if}
