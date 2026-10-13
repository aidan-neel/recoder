<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import GitPullRequest from '@lucide/svelte/icons/git-pull-request';
	import { Button } from '@sivir-ui/svelte/components/button';
	import { toast } from '@sivir-ui/svelte/components/toast';
	import QueueHeadline from './queue-headline.svelte';
	import QueueRow from './queue-row.svelte';
	import Keycap from '../ui/keycap.svelte';
	import type { QueueEntry } from '$lib/queue/queue';
	import { QueueState } from '$lib/queue/queue-state.svelte';
	import { listenKeys } from '$lib/shell/keys';
	import { shell } from '$lib/shell/shell.svelte';

	interface Props {
		sample: boolean;
	}

	let { sample }: Props = $props();

	const queue = new QueueState();

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
		else if (sample)
			toast.info('Only #214 opens in the sample', {
				description: 'Connect a repository to review your own pull requests.'
			});
		else void queue.start(entry);
	}

	$effect(() => {
		shell.waiting =
			queue.status === 'ready'
				? (queue.sections.find((section) => section.id === 'needs-you')?.entries.length ?? 0)
				: null;

		shell.crumb = null;

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

<div class="queue-scroll thin-scroll">
	<div class="queue-column">
		{#if queue.status === 'loading'}
			<div class="skeleton queue-headline-skeleton"></div>
			<div class="queue-list" aria-busy="true">
				{#each [0, 1, 2, 3, 4] as row (row)}
					<div class="queue-row-skeleton">
						<span class="skeleton" style:width="16px" style:height="16px" style:border-radius="999px"></span>
						<span class="flex flex-1 flex-col gap-2">
							<span class="skeleton" style:width="{[52, 38, 46, 30, 42][row]}%" style:height="12px"></span>
							<span class="skeleton" style:width="{[28, 22, 31, 25, 19][row]}%" style:height="10px"></span>
						</span>
					</div>
				{/each}
			</div>
		{:else if queue.status === 'offline' || queue.status === 'empty'}
			<div class="queue-empty">
				<h1 class="queue-headline">
					{queue.status === 'offline' ? 'Can’t reach the review server.' : 'No repositories tracked yet.'}
					<span class="queue-headline-rest">
						{queue.status === 'offline'
							? 'Start it with bun run dev, then try again. The sample review works without it.'
							: 'Track one in Recoder’s settings and its open pull requests land here.'}
					</span>
				</h1>
				<div class="queue-empty-actions">
					{#if queue.status === 'offline'}<Button onclick={() => void queue.load(false)}>Try again</Button>{/if}
					<Button variant="outline" href="/review/sample">Open the sample review</Button>
				</div>
			</div>
		{:else}
			<QueueHeadline sections={queue.sections} />
			{#each queue.sections as section (section.id)}
				<section class="queue-section" aria-labelledby="queue-{section.id}">
					<h2 class="queue-section-title" id="queue-{section.id}">
						{section.title}<span class="tabular">{section.entries.length}</span>
					</h2>
					<div class="queue-list" role="list">
						{#each section.entries as entry (entry.key)}
							<div data-key={entry.key} role="listitem">
								<QueueRow
									{entry}
									href={hrefFor(entry)}
									selected={entry.key === selectedKey}
									progress={entry.review ? queue.progress[entry.review.id] : undefined}
									onstart={(item) => queue.start(item)}
									onselect={() => (selectedKey = entry.key)}
								/>
							</div>
						{/each}
					</div>
				</section>
			{/each}
			<footer class="queue-keys" aria-label="Keyboard shortcuts">
				<span><Keycap key="j" /><Keycap key="k" /> move</span>
				<span><Keycap key="Enter" /> open</span>
				<span><Keycap key="r" /> review</span>
				<span><Keycap key="mod+k" /> search</span>
			</footer>
		{/if}
	</div>
</div>
