<script lang="ts" module>
	export type PillTone = 'high' | 'medium' | 'low' | 'info' | 'success';
	export const SEVERITY_LABEL: Record<PillTone, string> = {
		high: 'High',
		medium: 'Medium',
		low: 'Low',
		info: 'Info',
		success: 'Fixed'
	};
</script>

<script lang="ts">
	import type { Snippet } from 'svelte';
	import { Badge } from '@sivir-ui/svelte/components/badge';

	interface Props {
		tone: PillTone;
		children?: Snippet;
		class?: string;
	}

	/** Severity pill: 11px/500, padding 1px 6px, radius 5, text on tint. */
	let { tone, children, class: className = '' }: Props = $props();
</script>

<Badge variant="secondary" data-sev={tone} class="severity-pill {className}" role={undefined}>
	{#if children}{@render children()}{:else}{SEVERITY_LABEL[tone]}{/if}
</Badge>
