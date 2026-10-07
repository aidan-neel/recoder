<script lang="ts">
	import * as Card from '@sivir-ui/svelte/components/card';

	let { label, value, detail }: { label: string; value: string; detail?: string } = $props();
</script>

<Card.Root class="stat-tile">
	<span class="stat-label">{label}</span>
	<span class="stat-value">{value}</span>
	{#if detail}<span class="stat-detail">{detail}</span>{/if}
</Card.Root>
