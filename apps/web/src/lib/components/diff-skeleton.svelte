<script lang="ts">
	import Skeleton from '$lib/components/ui/skeleton.svelte';

	/** Placeholder for the diff pane: the 44px file header, then code lines on the 22px diff grid. */
	let { label = 'Loading diff' }: { label?: string } = $props();

	// Indent and width per line, so the block reads as code rather than a paragraph.
	const lines: [number, number][] = [
		[0, 46], [0, 0], [0, 38], [0, 0], [0, 30], [1, 52], [2, 64], [0, 0], [2, 34], [2, 42],
		[2, 70], [1, 8], [0, 0], [1, 40], [2, 58], [0, 0], [2, 48], [1, 8], [0, 0], [1, 44], [2, 36]
	];
</script>

<div class="flex min-h-0 min-w-0 flex-1 flex-col" role="status" aria-label={label} aria-busy="true">
	<div class="flex h-11 shrink-0 items-center gap-2.5 border-b border-line-divider pe-4 ps-5" aria-hidden="true">
		<Skeleton class="size-3.5 shrink-0" />
		<Skeleton class="h-3 w-72 max-w-[50%]" />
		<Skeleton class="h-3 w-14" />
		<Skeleton class="ms-auto h-7 w-28" />
	</div>
	<div class="min-h-0 flex-1 overflow-hidden py-1" aria-hidden="true">
		{#each lines as [indent, width], i (i)}
			<div class="grid h-[22px] grid-cols-[44px_44px_18px_1fr] items-center">
				<Skeleton class="ms-auto me-2 h-2.5 w-3" />
				<span></span>
				<span></span>
				{#if width}<div style:padding-inline-start="{indent * 28}px"><Skeleton class="h-2.5" w={width} unit="%" /></div>{/if}
			</div>
		{/each}
	</div>
</div>
