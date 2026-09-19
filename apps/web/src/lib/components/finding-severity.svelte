<script lang="ts">
	import { Button } from '@sivir-ui/svelte/components/button';
	import * as Typography from '@sivir-ui/svelte/components/typography';
	import type { FindingSeverity } from '$lib/findings.svelte';

	interface Props {
		severity: FindingSeverity;
		/** Shown after the label (filter counts). Omitted for single-finding labels. */
		count?: number | null;
		/** Interactive renders a compact severity filter; static renders plain text. */
		interactive?: boolean;
		/** Visible state for interactive toggles. Hidden severities dim. */
		pressed?: boolean;
		onToggle?: () => void;
	}

	let { severity, count = null, interactive = false, pressed = true, onToggle }: Props = $props();

	const label: Record<FindingSeverity, string> = {
		high: 'High',
		medium: 'Med',
		low: 'Low',
		info: 'Info'
	};

	const fg: Record<FindingSeverity, string> = {
		high: 'var(--sev-high-fg)',
		medium: 'var(--sev-medium-fg)',
		low: 'var(--sev-low-fg)',
		info: 'var(--sev-info-fg)'
	};

	const textClass = 'gap-1 font-sans text-[13px] font-medium tabular-nums';
</script>

{#if interactive}
	<Button
		variant="quiet"
		aria-pressed={pressed}
		title="Toggle {severity} findings"
		onclick={onToggle}
		class="!h-9 shrink-0 rounded-[10px] !px-2.5 transition-opacity {textClass} {pressed ? '' : 'opacity-40'} hover:opacity-80"
		style={`color: ${fg[severity]}; background: color-mix(in srgb, ${fg[severity]} 18%, var(--color-background))`}
	>
		{label[severity]}
		{#if count !== null}<span>{count}</span>{/if}
	</Button>
{:else}
	<Typography.Metadata class="inline-flex shrink-0 items-center {textClass}" style={`color: ${fg[severity]}`}>
		{label[severity]}
		{#if count !== null}<span>{count}</span>{/if}
	</Typography.Metadata>
{/if}
