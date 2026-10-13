<script lang="ts">
	import { onMount } from 'svelte';
	import CircleDot from '@lucide/svelte/icons/circle-dot';
	import CircleCheck from '@lucide/svelte/icons/circle-check';
	import FileCode from '@lucide/svelte/icons/file-code';
	import { Button } from '@sivir-ui/svelte/components/button';
	import DecisionBar from './decision-bar.svelte';
	import DecisionView from './decision-view.svelte';
	import FileView from './file-view.svelte';
	import HandoffModal from './handoff-modal.svelte';
	import OverviewView from './overview-view.svelte';
	import ReceiptView from './receipt-view.svelte';
	import ReviewHeader from './review-header.svelte';
	import ReviewRail from './review-rail.svelte';
	import ReviewRunning from './review-running.svelte';
	import { plain, where } from '$lib/review/labels';
	import { ReviewState } from '$lib/review/review-state.svelte';
	import { listenKeys, type KeyMap } from '$lib/shell/keys';
	import { shell } from '$lib/shell/shell.svelte';

	interface Props {
		id: string;
	}

	let { id }: Props = $props();

	const view = new ReviewState();

	let scroller = $state<HTMLElement>();

	const selection = $derived(view.selection);
	const decision = $derived(
		selection.kind === 'decision' ? view.surface?.decisions.find((item) => item.id === selection.id) : undefined
	);
	const receipt = $derived(
		selection.kind === 'receipt' ? view.surface?.receipts.find((item) => item.id === selection.id) : undefined
	);
	const file = $derived(
		selection.kind === 'file' ? view.surface?.files.find((item) => item.path === selection.path) : undefined
	);
	const empty = $derived(view.running && (view.surface?.decisions.length ?? 0) === 0);

	/** Each item opens at its top, with no scroll animation: keyboard moves are instant. */
	$effect(() => {
		void view.selection;
		scroller?.scrollTo({ top: 0 });
	});

	$effect(() => {
		const review = view.review;

		shell.crumb = review ? { label: view.repoName ?? 'Review', detail: `#${review.prNumber}` } : null;

		shell.pageItems = [
			...(view.surface?.decisions ?? []).map((item) => ({
				id: `d:${item.id}`,
				group: 'Decisions',
				label: plain(item.title),
				detail: where(item.file, item.line, null, true),
				icon: CircleDot,
				tone: `var(--sev-${item.tone === 'question' ? 'low' : item.tone}-solid)`,
				run: () => view.select({ kind: 'decision', id: item.id })
			})),
			...(view.surface?.receipts ?? []).map((item) => ({
				id: `r:${item.id}`,
				group: 'Checked for you',
				label: plain(item.question),
				icon: CircleCheck,
				tone: 'var(--ok)',
				run: () => view.select({ kind: 'receipt', id: item.id })
			})),
			...(view.surface?.files ?? []).map((item) => ({
				id: `f:${item.path}`,
				group: 'Files',
				label: item.path.slice(item.path.lastIndexOf('/') + 1),
				detail: item.path,
				icon: FileCode,
				run: () => view.select({ kind: 'file', path: item.path })
			}))
		];
	});

	function decide(kind: 'accepted' | 'sent' | 'dismissed'): void {
		if (decision && (kind !== 'dismissed' || decision.kind === 'finding')) view.decide(decision.id, kind);
	}

	function keys(): KeyMap {
		return {
			j: () => view.step(1),
			ArrowDown: () => view.step(1),
			k: () => view.step(-1),
			ArrowUp: () => view.step(-1),
			Enter: () => selection.kind === 'overview' && view.select(view.nextOpen(null)),
			a: () => decide('accepted'),
			s: () => decide('sent'),
			x: () => decide('dismissed'),
			u: () => view.undo(),
			h: () => view.sent.length > 0 && (view.handoffOpen = true),
			o: () => view.select({ kind: 'overview' }),
			Escape: () => view.select({ kind: 'overview' }),
			f: () => decision && view.select({ kind: 'file', path: decision.file })
		};
	}

	onMount(() => {
		void view.load(id);

		const stop = listenKeys(keys);

		return () => {
			stop();
			view.dispose();
			shell.crumb = null;
			shell.pageItems = [];
		};
	});
</script>

{#if view.status === 'loading'}
	<div class="review-page" aria-busy="true">
		<div class="review-head">
			<div class="review-head-main gap-2">
				<span class="skeleton" style:width="320px" style:height="15px"></span>
				<span class="skeleton" style:width="220px" style:height="11px"></span>
			</div>
		</div>
		<div class="review-body">
			<div class="rail">
				{#each [70, 82, 64, 76, 58] as width, index (index)}
					<div class="rail-row-skeleton"><span class="skeleton" style:width="{width}%" style:height="11px"></span></div>
				{/each}
			</div>
			<div class="review-main"></div>
		</div>
	</div>
{:else if view.status === 'missing' || view.status === 'offline'}
	<div class="review-missing">
		<h1 class="queue-headline">
			{view.status === 'missing' ? 'This review doesn’t exist.' : 'Can’t reach the review server.'}
			<span class="queue-headline-rest">
				{view.status === 'missing'
					? 'It may have been deleted, or the link is from another machine.'
					: 'Start it, then reload this page.'}
			</span>
		</h1>
		<Button variant="outline" href="/">Back to the queue</Button>
	</div>
{:else if view.review && view.surface}
	<div class="review-page">
		<ReviewHeader {view} />
		<div class="review-body">
			<ReviewRail {view} />
			<div class="review-main">
				<div class="review-scroll thin-scroll" bind:this={scroller}>
					{#if empty}
						<ReviewRunning {view} />
					{:else if decision}
						<DecisionView {decision} {view} />
					{:else if receipt}
						<ReceiptView {receipt} {view} />
					{:else if file}
						<FileView {file} {view} />
					{:else}
						<OverviewView {view} />
					{/if}
				</div>
				{#if decision}<DecisionBar {decision} {view} />{/if}
			</div>
		</div>
		<HandoffModal {view} />
	</div>
{/if}
