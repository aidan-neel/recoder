<script lang="ts">
	import type { ReviewToolCall } from '@recoder/shared';
	import CheckCheck from '@lucide/svelte/icons/check-check';
	import CircleAlert from '@lucide/svelte/icons/circle-alert';
	import CircleCheck from '@lucide/svelte/icons/circle-check';
	import MessageSquare from '@lucide/svelte/icons/message-square';
	import ScanSearch from '@lucide/svelte/icons/scan-search';
	import { Button } from '@sivir-ui/svelte/components/button';
	import { ScrollArea } from '@sivir-ui/svelte/components/scroll-area';
	import { Spinner } from '@sivir-ui/svelte/components/spinner';
	import * as Typography from '@sivir-ui/svelte/components/typography';
	import type { FileDiff } from '$lib/diff/diff';
	import { SEVERITIES, findingsStore, type Finding } from '$lib/findings/findings.svelte';
	import { compareSeverity } from '$lib/findings/severity';
	import { PendingAction } from '$lib/shell/pending-action.svelte';
	import FindingDetail from './finding-detail.svelte';
	import FindingsList from './findings-list.svelte';

	interface Props {
		files: FileDiff[];
		toolCalls?: ReviewToolCall[];
		/** Open the whole file in the inline diff. */
		onFullFile: (finding: Finding) => void;
		/** Open a file in the inline diff at a line (the evidence's "Open in diff"). */
		onOpenAt?: ((file: string, line: number | null) => void) | null;
		/** Where the review is, for the empty state. */
		status?: 'draft' | 'running' | 'failed' | 'done';
		onStartReview?: (() => Promise<void>) | null;
		onOpenDiff?: (() => void) | null;
		onAsk?: (() => void) | null;
		onConversation?: (() => void) | null;
		onRestart?: (() => void) | null;
		/** What a running review is doing right now ("Running checks · bun test"). */
		stageLabel?: string | null;
		/** Held by the developer; model calls wait until resumed. */
		paused?: boolean;
	}
	let {
		files,
		toolCalls = [],
		onFullFile,
		onOpenAt = null,
		status = 'done',
		onStartReview = null,
		onOpenDiff = null,
		onAsk = null,
		onConversation = null,
		onRestart = null,
		stageLabel = null,
		paused = false
	}: Props = $props();

	const dismissedCount = $derived(findingsStore.items.filter((f) => f.status === 'dismissed').length);
	const hiddenCount = $derived(
		findingsStore.items.filter((f) => f.status === 'open' && !findingsStore.isShown(f)).length
	);
	const emptyKind = $derived(
		status === 'draft'
			? 'draft'
			: status === 'running'
				? 'running'
				: status === 'failed' && findingsStore.items.length === 0
					? 'failed'
					: findingsStore.items.length === 0
						? 'clean'
						: 'caught-up'
	);
	const additions = $derived(files.reduce((sum, file) => sum + file.additions, 0));
	const deletions = $derived(files.reduce((sum, file) => sum + file.deletions, 0));
	const start = new PendingAction(() => onStartReview);

	let query = $state('');
	const ranked = $derived(
		findingsStore.items
			.filter(
				(finding) => (finding.status !== 'dismissed' || findingsStore.showDismissed) && findingsStore.isShown(finding)
			)
			.filter(
				(finding) =>
					!query.trim() ||
					`${finding.title} ${finding.body} ${finding.file} ${finding.category}`
						.toLowerCase()
						.includes(query.trim().toLowerCase())
			)
			.sort(
				(a, b) =>
					Number(a.status === 'dismissed') - Number(b.status === 'dismissed') ||
					compareSeverity(a, b) ||
					a.file.localeCompare(b.file) ||
					a.startLine - b.startLine
			)
	);
	const needsYou = $derived(ranked.filter((finding) => finding.status !== 'dismissed').length);
	const active = $derived(ranked.find((finding) => finding.id === findingsStore.activeId) ?? ranked[0]);
</script>

{#snippet ghostCards(shimmer: boolean)}
	<div class="focus-empty-ghosts" data-shimmer={shimmer || undefined} aria-hidden="true">
		{#each SEVERITIES as sev, i (sev)}
			<div class="focus-empty-ghost" style="--i: {i}">
				<span class="focus-empty-ghost-pill" data-sev={sev}></span>
				<span class="focus-empty-ghost-line" style="width: {[58, 72, 46][i]}%"></span>
				<span class="focus-empty-ghost-line is-faint" style="width: {[86, 64, 78][i]}%"></span>
			</div>
		{/each}
	</div>
{/snippet}

{#if ranked.length === 0 && !query.trim()}
	<div class="focus-empty" data-kind={emptyKind} data-waiting={paused || undefined}>
		<div class="focus-empty-card">
			<span class="focus-empty-icon" aria-hidden="true">
				{#if emptyKind === 'draft'}<ScanSearch size={20} />
				{:else if emptyKind === 'running' && paused}<CircleAlert size={20} />
				{:else if emptyKind === 'running'}<Spinner size={18} />
				{:else if emptyKind === 'failed'}<CircleAlert size={20} />
				{:else if emptyKind === 'clean'}<CircleCheck size={20} />
				{:else}<CheckCheck size={20} />{/if}
			</span>
			<Typography.Title level={2} class="focus-empty-title">
				{emptyKind === 'draft'
					? 'No findings yet'
					: emptyKind === 'running' && paused
						? 'Review paused'
						: emptyKind === 'running'
							? 'Reviewing this pull request'
							: emptyKind === 'failed'
								? "The review didn't finish"
								: emptyKind === 'clean'
									? 'Nothing to fix'
									: 'All caught up'}
			</Typography.Title>
			<p class="focus-empty-text">
				{#if emptyKind === 'draft'}Run the full review to check every change. Findings land here, ranked by severity.
				{:else if emptyKind === 'running' && paused}Model calls are on hold. Resume from the progress card in the
					conversation.
				{:else if emptyKind === 'running'}{stageLabel ? `${stageLabel}.` : 'Reviewing the diff.'} Findings appear here once
					the review consolidates them.
				{:else if emptyKind === 'failed'}No findings were saved. Restart the review to try again.
				{:else if emptyKind === 'clean'}The review found nothing in this pull request that needs a change.
				{:else}Every finding is fixed, dismissed or hidden by a filter.{/if}
			</p>
			<div class="focus-empty-facts">
				{#if emptyKind === 'caught-up'}
					{#if dismissedCount}<span><b>{dismissedCount}</b> dismissed</span>{/if}
					{#if hiddenCount}<span><b>{hiddenCount}</b> hidden</span>{/if}
				{:else if files.length}
					<span><b>{files.length}</b> {files.length === 1 ? 'file' : 'files'}</span>
					<span><b class="text-success">+{additions}</b> <b class="text-danger">−{deletions}</b></span>
				{/if}
			</div>
			<div class="focus-empty-actions">
				{#if emptyKind === 'draft' && onStartReview}
					<Button variant="primary" loading={start.running} disabled={start.running} onclick={() => void start.run()}
						>Start review</Button
					>
				{:else if emptyKind === 'running' && onConversation}
					<Button variant="outline" onclick={onConversation}>Watch progress</Button>
				{:else if emptyKind === 'failed' && onRestart}
					<Button variant="primary" onclick={onRestart}>Restart review</Button>
				{:else if emptyKind === 'caught-up' && hiddenCount}
					<Button variant="outline" onclick={() => findingsStore.showAllSeverities()}>Show all severities</Button>
				{/if}
				{#if emptyKind === 'caught-up' && dismissedCount}
					<Button variant="ghost" onclick={() => (findingsStore.showDismissed = true)}>Show dismissed</Button>
				{/if}
				{#if onOpenDiff && emptyKind !== 'failed'}<Button variant="ghost" onclick={onOpenDiff}>Open diff</Button>{/if}
				{#if onAsk && emptyKind !== 'running'}<Button variant="ghost" class="gap-1.5" onclick={onAsk}
						><MessageSquare size={14} aria-hidden="true" />Ask reviewer</Button
					>{/if}
			</div>
		</div>
		{#if emptyKind === 'draft' || emptyKind === 'running'}{@render ghostCards(emptyKind === 'running' && !paused)}{/if}
	</div>
{:else}
	<div class="focus-body">
		<FindingsList {ranked} activeId={active?.id} {needsYou} {dismissedCount} bind:query />

		<ScrollArea class="min-h-0" showCues={false} aria-label="Focused finding">
			{#if active}
				{#key active.id}
					<FindingDetail {active} {files} {toolCalls} {onFullFile} {onOpenAt} />
				{/key}
			{/if}
		</ScrollArea>
	</div>
{/if}
