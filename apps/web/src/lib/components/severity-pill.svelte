<script lang="ts">
	import { Badge } from '@sivir-ui/svelte/components/badge';
	import type { FindingSeverity } from '$lib/findings.svelte';

	interface Props {
		severity: FindingSeverity;
	}

	let { severity }: Props = $props();

	const label: Record<FindingSeverity, string> = {
		high: 'High',
		medium: 'Medium',
		low: 'Low',
		info: 'Info'
	};

	const style: Record<FindingSeverity, string> = {
		high: 'bg-[var(--sev-high-bg)] text-[var(--sev-high-fg)] ring-1 ring-inset ring-[var(--sev-high-line)]',
		medium: 'bg-[var(--sev-medium-bg)] text-[var(--sev-medium-fg)] ring-1 ring-inset ring-[var(--sev-medium-line)]',
		low: 'bg-[var(--sev-low-bg)] text-[var(--sev-low-fg)] ring-1 ring-inset ring-[var(--sev-low-line)]',
		info: 'bg-[var(--sev-info-bg)] text-[var(--sev-info-fg)] ring-1 ring-inset ring-[var(--sev-info-line)]'
	};
</script>

<Badge variant="outline" class="font-sans text-[13px] {style[severity]}">
	{label[severity]}
</Badge>
