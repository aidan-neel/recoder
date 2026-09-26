<script lang="ts">
	import Check from '@lucide/svelte/icons/check';
	import Wrench from '@lucide/svelte/icons/wrench';
	import { Button } from '@sivir-ui/svelte/components/button';
	import { Spinner } from '@sivir-ui/svelte/components/spinner';
	import { findingsStore, type Finding } from '$lib/findings.svelte';
	import { applyFix, suggestFix } from '$lib/fixes';
	import { threadsStore } from '$lib/threads.svelte';

	let { finding, variant = 'primary', class: className = '' }: { finding: Finding; variant?: 'primary' | 'outline'; class?: string } = $props();
	const suggestion = $derived(findingsStore.suggestions[finding.id]);
	/** A patch has to exist before it can be pushed, so the first step asks for one. */
	const state = $derived(
		finding.status === 'accepted' || suggestion?.apply === 'applied' ? 'applied'
			: suggestion?.apply === 'applying' ? 'applying'
			: suggestion?.status === 'loading' ? 'suggesting'
			: suggestion?.status === 'ready' && suggestion.patch ? 'ready'
			: 'idle'
	);
</script>

<Button
	variant={state === 'applied' ? 'outline' : variant}
	class="fix-button {className}"
	data-state={state}
	disabled={!threadsStore.reviewId || state === 'suggesting' || state === 'applying' || state === 'applied'}
	aria-live="polite"
	onclick={() => void (state === 'ready' ? applyFix(finding) : suggestFix(finding))}
>
	{#if state === 'suggesting'}<Spinner size={13} aria-hidden="true" />Preparing
	{:else if state === 'applying'}<Spinner size={13} aria-hidden="true" />Applying
	{:else if state === 'applied'}<Check size={14} aria-hidden="true" />Applied
	{:else if state === 'ready'}<Wrench size={14} aria-hidden="true" />Apply fix
	{:else}<Wrench size={14} aria-hidden="true" />Suggest fix{/if}
</Button>
