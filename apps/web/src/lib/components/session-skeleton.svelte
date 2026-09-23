<script lang="ts">
	import * as Card from '@sivir-ui/svelte/components/card';
	import { ScrollArea } from '@sivir-ui/svelte/components/scroll-area';
	import Skeleton from '$lib/components/ui/skeleton.svelte';

	let { specialist = false }: { specialist?: boolean } = $props();
</script>

<section class="flex h-full min-h-0 flex-col" role="status" aria-label={specialist ? 'Loading specialist conversation' : 'Loading session'} aria-busy="true">
	<header class="flex min-h-14 shrink-0 flex-wrap items-center justify-between gap-x-6 gap-y-3 px-3 py-4" aria-hidden="true">
		<Skeleton class="h-4 w-80 max-w-full rounded-md" />
		<div class="ms-auto flex items-center gap-3">
			<Skeleton class="h-5 w-24 rounded-md" />
			<Skeleton class="h-3 w-20 rounded-md" />
			<Skeleton class="h-3 w-12 rounded-md" />
		</div>
	</header>
	{#if specialist}
		<div class="mx-auto flex w-full max-w-[776px] shrink-0 items-center gap-3 px-4 pb-3 pt-1 sm:px-6" aria-hidden="true">
			<Skeleton class="size-9 rounded-lg" />
			<Skeleton class="h-4 w-32 rounded-md" />
			<div class="ms-auto"><Skeleton class="h-6 w-16 rounded-md" /></div>
		</div>
	{/if}
	<ScrollArea showCues={false} class="min-h-0 flex-1" aria-hidden="true" tabindex={-1}>
		<div class="mx-auto flex w-full max-w-[776px] flex-col gap-6 px-4 py-2 sm:px-6">
			<Card.Root class="ms-auto w-80 max-w-[85%] rounded-xl border-0 bg-secondary !p-3 shadow-none">
				<Skeleton class="h-4 w-full rounded-md" />
			</Card.Root>
			<div class="flex items-center gap-2">
				<Skeleton class="h-3 w-32 rounded-md" />
				<Skeleton class="size-3 rounded-sm" />
			</div>
			<div class="flex flex-col gap-2.5">
				<Skeleton class="h-4 w-full rounded-md" />
				<Skeleton class="h-4 w-4/5 rounded-md" />
			</div>
			{#if !specialist}
				<Skeleton class="h-3 w-36 rounded-md" />
				<Card.Root class="!gap-0 rounded-xl border border-border bg-transparent !p-0 shadow-none">
					{#each [0, 1, 2] as row (row)}
						<div class="flex min-h-[68px] flex-col gap-2 px-3 py-3">
							<div class="flex items-center justify-between gap-4">
								<Skeleton class="h-4 w-28 rounded-md" />
								<Skeleton class="h-6 w-20 rounded-md" />
							</div>
							<Skeleton class="h-3 w-3/5 rounded-md" />
						</div>
					{/each}
				</Card.Root>
			{:else}
				<Card.Root class="flex-col gap-3 rounded-xl border border-border bg-transparent !p-4 shadow-none">
					<Skeleton class="h-3 w-36 rounded-md" />
					<Skeleton class="h-3 w-4/5 rounded-md" />
					<Skeleton class="h-3 w-2/3 rounded-md" />
				</Card.Root>
			{/if}
			<Skeleton class="h-3 w-40 rounded-md" />
		</div>
	</ScrollArea>
	<div class="mx-auto w-full max-w-[776px] shrink-0 px-4 pb-8 pt-4 sm:px-6" aria-hidden="true">
		<Card.Root class="h-[46px] flex-row items-center gap-4 rounded-full border border-border bg-card !py-1 !pe-2.5 !ps-4 shadow-none">
			<div class="min-w-0 flex-1"><Skeleton class="h-4 w-52 max-w-full rounded-md" /></div>
			<Skeleton class="size-3.5 shrink-0 rounded-md" />
			<Skeleton class="size-7 shrink-0 rounded-full" />
		</Card.Root>
	</div>
</section>
