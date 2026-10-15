<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import GitPullRequest from '@lucide/svelte/icons/git-pull-request';
	import { Button } from '@sivir-ui/svelte/components/button';
	import { ScrollArea } from '@sivir-ui/svelte/components/scroll-area';
	import { toast } from '@sivir-ui/svelte/components/toast';
	import QueueHeadline from './queue-headline.svelte';
	import PrRow from '$web/components/home/pr-row.svelte';
	import Skeleton from '$web/components/ui/skeleton.svelte';
	import { hoverHighlight } from '$web/shell/hover-highlight';
	import { entryStatus, type QueueEntry } from '$lib/queue/queue';
	import { QueueState } from '$lib/queue/queue-state.svelte';
	import { listenKeys } from '$lib/shell/keys';
	import { shell } from '$lib/shell/shell.svelte';

	interface Props {
		sample: boolean;
	}

	let { sample }: Props = $props();

	const queue = new QueueState();

	/** The row j and k have moved to; hover uses its own layer. */
	let selectedKey = $state<string | null>(null);

	const ordered = $derived(queue.sections.flatMap((section) => section.entries));
	const selected = $derived(ordered.find((entry) => entry.key === selectedKey) ?? null);

	function hrefFor(entry: QueueEntry): string | null {
		if (sample) return entry.review?.id === 'sample' ? '/review/sample' : null;
		if (!entry.review || entry.state === 'unreviewed') return null;

		return `/review/${entry.review.id}`;
	}

	function move(step: number): void {
		if (ordered.length === 0) return;

		const at = ordered.findIndex((entry) => entry.key === selectedKey);
		const next = ordered[Math.min(ordered.length - 1, Math.max(0, at === -1 ? 0 : at + step))];

		selectedKey = next.key;
		document.querySelector(`[data-key="${CSS.escape(next.key)}"]`)?.scrollIntoView({ block: 'nearest' });
	}

	function open(entry: QueueEntry | null): void {
		if (!entry) return;

		const href = hrefFor(entry);

		if (href) void goto(href);
		else if (sample) blocked();
		else void queue.start(entry);
	}

	function blocked(): void {
		toast.info('Only #214 opens in the sample', {
			description: 'Track a repository to review your own pull requests.'
		});
	}

	$effect(() => {
		shell.waiting =
			queue.status === 'ready'
				? (queue.sections.find((section) => section.id === 'needs-you')?.entries.length ?? 0)
				: null;

		shell.pageItems = ordered.map((entry) => ({
			id: entry.key,
			group: 'Pull requests',
			label: entry.pull.title,
			detail: `${entry.repo.split('/').pop()} #${entry.pull.number}`,
			icon: GitPullRequest,
			run: () => open(entry)
		}));
	});

	onMount(() => {
		void queue.load(sample);

		const stop = listenKeys(() => ({
			j: () => move(1),
			ArrowDown: () => move(1),
			k: () => move(-1),
			ArrowUp: () => move(-1),
			Enter: () => open(selected),
			r: () => selected && selected.state !== 'reviewing' && void queue.start(selected)
		}));

		return () => {
			stop();
			queue.dispose();
			shell.pageItems = [];
		};
	});
</script>

<ScrollArea class="h-full min-h-0" aria-label="Queue" showCues={false}>
	<div class="home-column">
		{#if queue.status === 'loading'}
			<div class="queue-brief"><Skeleton class="h-[27px] w-[62%]" /></div>
			<div class="pr-list" aria-busy="true">
				{#each [52, 38, 46, 30, 42] as width, index (index)}
					<div class="pr-row">
						<Skeleton class="h-4 w-4 rounded-full" />
						<span class="flex flex-1 flex-col gap-2">
							<Skeleton class="h-3" w={width} unit="%" />
							<Skeleton class="h-2.5" w={width / 2 + 10} unit="%" />
						</span>
					</div>
				{/each}
			</div>
		{:else if queue.status === 'offline' || queue.status === 'empty'}
			<p class="home-brief ai-voice queue-brief">
				<span class="text-fg">
					{queue.status === 'offline' ? 'Can’t reach the review server.' : 'No repositories tracked yet.'}
				</span>
				{queue.status === 'offline'
					? 'Start it with bun run dev, then try again. The sample review works without it.'
					: 'Track one in Recoder’s settings and its open pull requests land here.'}
			</p>
			<div class="queue-empty-actions">
				{#if queue.status === 'offline'}<Button onclick={() => void queue.load(false)}>Try again</Button>{/if}
				<Button variant="outline" href="/review/sample">Open the sample review</Button>
			</div>
		{:else}
			<QueueHeadline sections={queue.sections} />
			{#each queue.sections as section (section.id)}
				<section class="queue-section" aria-labelledby="queue-{section.id}">
					<h2 class="group-head" id="queue-{section.id}">
						{section.title}<span class="font-mono text-[11.5px] text-fg-faint">{section.entries.length}</span>
					</h2>
					<div class="pr-list" {@attach hoverHighlight({ items: '.pr-row', class: 'hl-row' })}>
						{#each section.entries as entry (entry.key)}
							<div data-key={entry.key}>
								<PrRow
									pr={entry.pull}
									review={entry.review ?? undefined}
									status={entryStatus(entry)}
									highlighted={entry.key === selectedKey}
									progress={entry.review ? queue.progress[entry.review.id] : undefined}
									onOpen={() => open(entry)}
									onReview={() => void queue.start(entry)}
								/>
							</div>
						{/each}
					</div>
				</section>
			{/each}
		{/if}
	</div>
</ScrollArea>
