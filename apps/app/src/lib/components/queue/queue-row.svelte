<script lang="ts">
	import Bot from '@lucide/svelte/icons/bot';
	import { Button } from '@sivir-ui/svelte/components/button';
	import StatusGlyph, { type GlyphKind } from '../ui/status-glyph.svelte';
	import type { QueueEntry } from '$lib/queue/queue';
	import { ago, author, plural } from '$lib/shell/format';

	interface Props {
		entry: QueueEntry;
		href: string | null;
		selected: boolean;
		progress: { tasksDone: number; tasksTotal: number } | undefined;
		onstart: (entry: QueueEntry) => Promise<void>;
		onselect: () => void;
	}

	let { entry, href, selected, progress, onstart, onselect }: Props = $props();

	let starting = $state<'idle' | 'loading' | 'error'>('idle');

	const who = $derived(author(entry.pull.author));

	const glyph = $derived.by((): GlyphKind => {
		switch (entry.state) {
			case 'needs-you':
				return entry.tone ?? 'medium';
			case 'reviewing':
				return 'spinner';
			case 'with-agent':
				return 'sent';
			case 'ready':
				return 'ok';
			case 'failed':
				return 'failed';
			case 'outdated':
				return 'outdated';
			default:
				return 'idle';
		}
	});

	async function start(event: MouseEvent): Promise<void> {
		event.preventDefault();
		event.stopPropagation();
		starting = 'loading';

		try {
			await onstart(entry);
			starting = 'idle';
		} catch {
			starting = 'error';
		}
	}
</script>

{#snippet body()}
	<StatusGlyph kind={glyph} class="queue-glyph" />
	<span class="queue-main">
		<span class="queue-title truncate">{entry.pull.title}</span>
		<span class="queue-meta">
			<span class="mono">{entry.repo.split('/').pop()} #{entry.pull.number}</span>
			<span class="queue-sep" aria-hidden="true">·</span>
			<span class="queue-author" class:agent={who.agent}>
				{#if who.agent}<Bot size={12} aria-label="Agent" />{/if}{who.name}
			</span>
			<span class="queue-sep" aria-hidden="true">·</span>
			<span class="mono tabular"
				><span class="text-ok">+{entry.pull.additions}</span>
				<span class="text-sev-high">−{entry.pull.deletions}</span></span
			>
			<span class="queue-sep" aria-hidden="true">·</span>
			<span class="tabular">{ago(entry.pull.createdAt)}</span>
		</span>
	</span>
	<span class="queue-state">
		{#if entry.state === 'needs-you'}
			<span class="pill" data-tone={entry.tone}>{plural(entry.open, 'decision')}</span>
			{#if entry.receipts > 0}<span class="queue-quiet">{entry.receipts} checked</span>{/if}
		{:else if entry.state === 'reviewing'}
			<span class="queue-quiet shimmer-text">Reviewing</span>
			{#if progress && progress.tasksTotal > 0}
				<span
					class="queue-meter"
					role="progressbar"
					aria-valuemin={0}
					aria-valuemax={progress.tasksTotal}
					aria-valuenow={progress.tasksDone}
				>
					<span style:scale="{progress.tasksDone / progress.tasksTotal} 1"></span>
				</span>
			{/if}
		{:else if entry.state === 'with-agent'}
			<span class="pill" data-tone="sent">{entry.sent} sent back</span>
		{:else if entry.state === 'ready'}
			<span class="pill" data-tone="ok">Ready</span>
		{:else}
			{#if entry.state === 'outdated'}<span class="queue-quiet">New commits</span>{/if}
			{#if entry.state === 'failed'}<span class="queue-quiet text-sev-high">Review failed</span>{/if}
			<Button
				variant="outline"
				class="queue-start"
				status={starting}
				loadingLabel="Starting"
				errorLabel="Retry"
				onclick={start}
			>
				{entry.state === 'unreviewed' ? 'Review' : entry.state === 'failed' ? 'Retry' : 'Re-review'}
			</Button>
		{/if}
	</span>
{/snippet}

{#if href}
	<a class="queue-row" data-selected={selected} {href} onpointermove={selected ? undefined : onselect}
		>{@render body()}</a
	>
{:else}
	<div class="queue-row" data-selected={selected} role="listitem" onpointermove={selected ? undefined : onselect}>
		{@render body()}
	</div>
{/if}
