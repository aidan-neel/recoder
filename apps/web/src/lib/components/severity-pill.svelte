<script lang="ts">
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
		high: 'bg-error/15 text-error',
		medium: 'bg-warning/15 text-warning',
		low: 'bg-[#141c28] text-[#5698ff]',
		info: 'bg-secondary text-foreground-muted'
	};
</script>

<span class="rounded px-1.5 py-0.5 font-sans text-[13px] font-semibold {style[severity]}">
	{label[severity]}
</span>
