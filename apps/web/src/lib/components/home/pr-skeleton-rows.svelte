<script lang="ts">
	import Skeleton from '$lib/components/ui/skeleton.svelte';

	/** Placeholder rows in the same box as `.pr-row`: a 20px title line over an 18px mono meta line. */
	interface Props {
		count: number;
	}

	let { count }: Props = $props();
</script>

<div role="status" aria-label="Loading pull requests" class="pr-list">
	{#each Array(count) as _, i (i)}
		<div class="flex items-center gap-3.5 border-b border-line-subtle px-3 py-3.5" aria-hidden="true">
			<Skeleton class="size-4 shrink-0 self-start" />
			<div class="flex min-w-0 flex-1 flex-col gap-1.5">
				<div class="flex h-5 items-center"><Skeleton class="h-3.5" w={[62, 48, 56][i % 3]} unit="%" /></div>
				<div class="flex h-[18px] items-center"><Skeleton class="h-2.5" w={[40, 34, 44][i % 3]} unit="%" /></div>
			</div>
			<Skeleton class="h-5 w-14" />
			<Skeleton class="size-3.5" />
		</div>
	{/each}
</div>
