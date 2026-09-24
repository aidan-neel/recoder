<script lang="ts">
	import { Button } from '@sivir-ui/svelte/components/button';
	import type { FindingSeverity } from '$lib/findings.svelte';
	import SeverityPill from './ui/severity-pill.svelte';

	interface Props {
		severity: FindingSeverity;
		/** Shown after the label (filter counts). Omitted for single-finding labels. */
		count?: number | null;
		/** Interactive renders a toolbar severity filter chip; static renders a pill. */
		interactive?: boolean;
		/** Visible state for interactive toggles. Hidden severities dim. */
		pressed?: boolean;
		onToggle?: () => void;
	}

	let { severity, count = null, interactive = false, pressed = true, onToggle }: Props = $props();

	/** Toolbar chips use the compact labels from artboard 3c. */
	const chipLabel: Record<FindingSeverity, string> = {
		high: 'High',
		medium: 'Med',
		low: 'Low',
		info: 'Info'
	};
</script>

{#if interactive}
	<Button
		variant="quiet"
		aria-pressed={pressed}
		title="Toggle {severity} findings"
		onclick={onToggle}
		data-sev={severity}
		class="severity-chip shrink-0 gap-1.5 tabular-nums {pressed ? '' : 'opacity-40'}"
	>
		{chipLabel[severity]}
		{#if count !== null}<span class="opacity-80">{count}</span>{/if}
	</Button>
{:else}
	<SeverityPill tone={severity}>
		{#if count !== null}{chipLabel[severity]} {count}{:else}{chipLabel[severity] === 'Med' ? 'Medium' : chipLabel[severity]}{/if}
	</SeverityPill>
{/if}
