<script lang="ts">
	import { categoryLabel, SMELL_LABELS, VERIFY_METHOD_LABELS } from '$lib/findings/finding-labels';
	import type { Finding } from '$lib/findings/findings.svelte';

	interface Props {
		finding: Finding;
		/** Off where the row is too narrow for the enclosing function's name. */
		symbol?: boolean;
		class?: string;
	}

	/**
	 * What a finding is about: its category, rule id, smell and symbol. The category is left out when the
	 * verification badge beside it already says the same word ("Repo rule", "Convention").
	 */
	let { finding, symbol = true, class: className = '' }: Props = $props();

	const label = $derived(categoryLabel(finding.category));

	const badged = $derived(
		finding.verification?.status === 'verified' &&
			!!finding.verification.method &&
			VERIFY_METHOD_LABELS[finding.verification.method] === label
	);
</script>

<span class="finding-facets {className}">
	{#if !badged || finding.ruleId}<span
			>{#if !badged}{label}{/if}{#if !badged && finding.ruleId}{' '}{/if}{#if finding.ruleId}<span
					class="finding-facets-mono">{finding.ruleId}</span
				>{/if}</span
		>{/if}
	{#if finding.smell}<span>{SMELL_LABELS[finding.smell]}</span>{/if}
	{#if symbol && finding.symbol}<span class="finding-facets-mono" title={finding.symbol}>{finding.symbol}</span>{/if}
</span>
