<script lang="ts">
	import Skeleton from './ui/skeleton.svelte';

	/** Placeholder for the usage modals: the account line, then meters (label and value, 3px bar, note). */
	let { label, meters = 2, detail = false }: { label: string; meters?: number; detail?: boolean } = $props();
</script>

<div class="flex flex-col gap-5" role="status" aria-label={label}>
	<div class="flex flex-col gap-2" aria-hidden="true">
		<div class="flex h-5 items-center"><Skeleton class="h-3.5 w-52" /></div>
		{#if detail}<Skeleton class="h-3 w-72 max-w-full" />{/if}
	</div>
	<div class="flex flex-col gap-4" aria-hidden="true">
		{#each Array(meters) as _, i (i)}
			<div class="flex flex-col gap-2">
				<div class="flex h-[18px] items-center justify-between gap-3"><Skeleton class="h-3 w-32" /><Skeleton class="h-3 w-16" /></div>
				<Skeleton class="h-[3px] w-full" />
				<div class="flex h-4 items-center"><Skeleton class="h-2.5" w={i % 2 ? 44 : 58} unit="%" /></div>
			</div>
		{/each}
	</div>
</div>
