<script lang="ts">
	import * as Card from '@sivir-ui/svelte/components/card';
	import Skeleton from '$web/components/ui/skeleton.svelte';

	/** An undefined value draws the tile loading, at the size it will have. */
	let { label, value, detail }: { label: string; value: string | undefined; detail?: string } = $props();
</script>

<Card.Root class="stat-tile">
	<span class="stat-label">{label}</span>
	{#if value === undefined}
		<Skeleton class="my-1 h-[22px] w-16" />
		<Skeleton class="my-[2.25px] h-3 w-24" />
	{:else}
		<span class="stat-value">{value}</span>
		{#if detail}<span class="stat-detail">{detail}</span>{/if}
	{/if}
</Card.Root>
