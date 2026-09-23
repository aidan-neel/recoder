<script lang="ts">
	import type { FixSuggestion } from '$lib/findings.svelte';

	let { suggestion }: { suggestion: FixSuggestion } = $props();
	/** Changed lines only; file headers and hunk markers add noise at this size. */
	const lines = $derived((suggestion.patch ?? '').split('\n').filter((line) =>
		(line.startsWith('+') || line.startsWith('-')) && !line.startsWith('+++') && !line.startsWith('---')));
</script>

<figure class="suggested-fix" aria-label="Suggested fix">
	<figcaption class="suggested-fix-head">
		<span>Suggested fix</span>
		{#if suggestion.applies === true}<span class="text-success">· applies cleanly</span>
		{:else if suggestion.applies === false}<span class="text-sev-medium">· may not apply cleanly</span>{/if}
	</figcaption>
	{#if suggestion.summary}<p class="suggested-fix-summary">{suggestion.summary}</p>{/if}
	<pre class="suggested-fix-code">{#each lines as line, i (i)}<span data-sign={line[0]}><span class="suggested-fix-sign" aria-hidden="true">{line[0]}</span>{line.slice(1) || ' '}</span>{/each}</pre>
</figure>
