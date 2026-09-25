<script lang="ts">
	import * as Card from '@sivir-ui/svelte/components/card';
	import Skeleton from '$lib/components/ui/skeleton.svelte';
	import DiffSkeleton from './diff-skeleton.svelte';

	/**
	 * Mirrors the session layout the URL is about to show: the session bar
	 * (title, centred view tabs, actions), then the conversation, a specialist's
	 * conversation, the findings list or the diff.
	 */
	let { view = 'conversation' }: { view?: 'conversation' | 'specialist' | 'findings' | 'diff' } = $props();
	const workspace = $derived(view === 'findings' || view === 'diff');
</script>

<section class="flex h-full min-h-0 flex-col" role="status" aria-label={view === 'specialist' ? 'Loading specialist conversation' : 'Loading session'} aria-busy="true">
	<header class="session-header" data-bordered="" data-merged="" aria-hidden="true">
		<Skeleton class="h-3.5 w-80 max-w-[40%]" />
		<div class="view-switch"><Skeleton class="h-7 w-[205px]" /></div>
		<div class="order-2 flex items-center gap-3 min-[1280px]:ms-auto">
			<Skeleton class="h-3 w-20" />
			{#if workspace}<Skeleton class="h-8 w-28" /><Skeleton class="h-8 w-24" />{/if}
		</div>
	</header>

	<div class="flex min-h-0 flex-1" aria-hidden="true">
		{#if view === 'diff'}
			<div class="diff-tree hidden flex-col gap-3 px-3.5 py-3.5 lg:flex">
				<Skeleton class="h-3.5 w-24" />
				<div class="grid grid-cols-2 gap-1.5">
					{#each [0, 1, 2, 3] as i (i)}<Skeleton class="h-[26px]" />{/each}
				</div>
				<Skeleton class="h-[30px]" />
				<Skeleton class="mt-4 h-3.5 w-28" />
				<Skeleton class="h-7" />
				{#each [0, 1, 2, 3, 3, 3, 3, 2] as depth, i (i)}
					<div style:padding-inline-start="{depth * 12}px"><Skeleton class="h-3" w={i % 3 ? 52 : 38} unit="%" /></div>
				{/each}
			</div>
			<DiffSkeleton label="Loading diff" />
		{:else if view === 'findings'}
			<div class="flex w-[434px] shrink-0 flex-col gap-2 p-3 max-xl:w-[360px]">
				<div class="flex h-9 items-center gap-3 px-1.5"><Skeleton class="h-3.5 w-20" /><Skeleton class="h-3 w-16" /></div>
				{#each [2, 1, 2, 2, 1] as titleLines, i (i)}
					<Card.Root class="gap-3 rounded-xl border-0 bg-raised !p-3.5 shadow-none ring-1 ring-line-card">
						<div class="flex items-center gap-2"><Skeleton class="h-[18px] w-14" /><Skeleton class="h-3 w-20" /><Skeleton class="ms-auto h-3 w-32" /></div>
						<Skeleton class="h-3.5 w-11/12" />
						{#if titleLines === 2}<Skeleton class="-mt-1 h-3.5 w-3/5" />{/if}
					</Card.Root>
				{/each}
			</div>
			<div class="flex min-w-0 flex-1 flex-col gap-3 py-3 pe-3">
				<Card.Root class="min-h-0 flex-1 !gap-0 overflow-hidden rounded-xl border-0 bg-transparent !p-0 shadow-none ring-1 ring-line-card">
					<DiffSkeleton label="Loading finding" />
				</Card.Root>
				<Card.Root class="h-44 shrink-0 gap-3 rounded-xl border-0 bg-raised !p-4 shadow-none ring-1 ring-line-card">
					<div class="flex items-center gap-2"><Skeleton class="h-[18px] w-14" /><Skeleton class="h-3.5 w-64" /></div>
					<Skeleton class="h-3.5 w-full" />
					<Skeleton class="h-3.5 w-4/5" />
				</Card.Root>
			</div>
		{:else}
			<div class="flex min-w-0 flex-1 flex-col">
				<div class="mx-auto flex min-h-0 w-full max-w-[740px] flex-1 flex-col px-6">
					{#if view === 'specialist'}
						<div class="flex items-center gap-1.5 pt-3">
							<Skeleton class="size-[30px]" />
							<Skeleton class="h-3.5 w-28" />
							<Skeleton class="ms-auto h-3 w-14" />
						</div>
						<div class="flex flex-col gap-2.5 pt-8">
							<Skeleton class="h-3.5 w-11/12" />
							<Skeleton class="h-3.5 w-full" />
							<Skeleton class="h-3.5 w-2/3" />
						</div>
						<div class="flex flex-col gap-2 pt-6">
							{#each [0, 1, 2] as i (i)}<div class="flex items-center gap-2"><Skeleton class="size-3" /><Skeleton class="h-3 w-48" /></div>{/each}
						</div>
					{:else}
						<Skeleton class="mt-9 h-4 w-40" />
						<div class="mt-3 -mx-2.5 flex flex-col gap-0.5">
							{#each [0, 1, 2] as i (i)}
								<div class="flex h-[61px] items-center gap-3.5 px-2.5">
									<div class="flex min-w-0 flex-1 flex-col gap-2">
										<div class="flex items-center gap-2"><Skeleton class="h-3.5 w-28" /><Skeleton class="h-2.5 w-12" /></div>
										<Skeleton class="h-3 w-40" />
									</div>
									<Skeleton class="h-[22px] w-16" />
									<Skeleton class="size-3" />
								</div>
							{/each}
						</div>
						<Skeleton class="mt-5 h-4 w-36" />
					{/if}
				</div>
				<div class="mx-auto w-full max-w-[740px] shrink-0 px-6 pb-[22px] pt-4">
					<Card.Root class="h-[85px] justify-between rounded-[18px] border-0 bg-raised !px-4 !py-3.5 shadow-none ring-1 ring-line-card">
						<Skeleton class="h-3.5 w-56 max-w-full" />
						<div class="flex items-center gap-3">
							<Skeleton class="size-4" />
							<Skeleton class="ms-auto h-3 w-24" />
							<Skeleton class="size-7 !rounded-full" />
						</div>
					</Card.Root>
				</div>
			</div>
			{#if view === 'conversation'}
				<aside class="results-rail">
					<div class="results-rail-body">
						<Card.Root class="rail-card">
							<div class="rail-card-head items-center"><Skeleton class="h-3.5 w-16" /><Skeleton class="ms-auto h-3 w-20" /></div>
							<div class="flex flex-col pb-2.5">
								{#each [0, 1, 2, 3] as i (i)}
									<div class="flex h-[30px] items-center gap-2.5 px-3.5"><Skeleton class="size-3.5 !rounded-full" /><Skeleton class="h-3 w-36" /></div>
								{/each}
							</div>
						</Card.Root>
						<Card.Root class="rail-card">
							<div class="rail-card-head items-center"><Skeleton class="h-3.5 w-16" /><Skeleton class="ms-auto h-3 w-4" /></div>
							{#each [0, 1, 2, 3, 4] as i (i)}
								<div class="flex gap-2.5 border-t border-[var(--bg-bubble)] px-3.5 py-2.5">
									<Skeleton class="h-[18px] w-14 shrink-0" />
									<div class="flex min-w-0 flex-1 flex-col gap-2 pt-0.5">
										<Skeleton class="h-3 w-full" />
										<Skeleton class="h-3 w-3/5" />
										<Skeleton class="h-2.5 w-4/5" />
									</div>
								</div>
							{/each}
						</Card.Root>
					</div>
				</aside>
			{/if}
		{/if}
	</div>
</section>
