<script lang="ts">
	import type { Evidence } from '$lib/review/surface';

	interface Props {
		evidence: Evidence;
	}

	let { evidence }: Props = $props();

	const failed = $derived(evidence.exitCode !== null && evidence.exitCode !== 0);
</script>

<figure class="evidence">
	{#if evidence.input}
		<div class="evidence-row">
			<span class="evidence-label">Tried</span>
			<span class="evidence-value">{evidence.input}</span>
		</div>
	{/if}
	{#if evidence.command}
		<div class="evidence-row">
			<span class="evidence-label">Ran</span>
			<code class="evidence-command mono">$ {evidence.command}</code>
			{#if evidence.exitCode !== null}
				<span class="evidence-exit mono" data-failed={failed}>exit {evidence.exitCode}</span>
			{/if}
		</div>
	{/if}
	{#if evidence.expected}
		<div class="evidence-row">
			<span class="evidence-label">Expected</span>
			<span class="evidence-value">{evidence.expected}</span>
		</div>
	{/if}
	{#if evidence.observed}
		<pre class="evidence-output mono thin-scroll">{evidence.observed}</pre>
	{/if}
	{#if evidence.baseResult}
		<figcaption class="evidence-base">
			{evidence.baseResult === 'regression'
				? 'Passes on the base branch, so this PR introduced it.'
				: evidence.baseResult === 'pre-existing'
					? 'Fails the same way on the base branch: it predates this PR.'
					: `Base branch: ${evidence.baseResult}.`}
		</figcaption>
	{/if}
</figure>
