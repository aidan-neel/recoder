<script lang="ts">
	import type { ReviewToolCall } from '@recoder/shared';
	import ArrowUpRight from '@lucide/svelte/icons/arrow-up-right';
	import Maximize2 from '@lucide/svelte/icons/maximize-2';
	import { Button } from '@sivir-ui/svelte/components/button';
	import { CodeBlock } from '@sivir-ui/svelte/components/code-block';
	import * as FileDiff from '@sivir-ui/svelte/components/file-diff';
	import * as Modal from '@sivir-ui/svelte/components/modal';
	import { ScrollArea } from '@sivir-ui/svelte/components/scroll-area';
	import { evidenceView, langForPath } from '$lib/evidence';
	import { fileIconUrl } from '$lib/material-icons';

	/**
	 * A finding's cited tool result: diffs and file reads in Sivir FileDiff (with a
	 * full-screen lightbox and a jump into the Diff view), anything else as text.
	 */
	let { tool, onOpenInDiff = null }: {
		tool: ReviewToolCall;
		/** Open the evidence's file in the Diff view at `line`. Omit when the file isn't in this PR. */
		onOpenInDiff?: ((file: string, line: number | null) => void) | null;
	} = $props();
	let lightbox = $state(false);
	const view = $derived(evidenceView(tool));
	const lines = $derived(view && view.kind !== 'text' ? view.lines : []);
	const additions = $derived(lines.filter((line) => line.type === 'add').length);
	const deletions = $derived(lines.filter((line) => line.type === 'remove').length);
	/** New files and excerpts have no old-side numbers; drop that gutter column. */
	const singleGutter = $derived(deletions === 0);
	const name = $derived(view && view.kind !== 'text' ? (view.file.split('/').at(-1) ?? view.file) : '');
	const range = $derived(view?.kind === 'file' ? `lines ${lines[0]?.newLineNumber}–${lines.at(-1)?.newLineNumber}` : null);
	/** Where to land in the Diff view: the first changed line, or the excerpt's first line. */
	const target = $derived.by(() => {
		const line = lines.find((row) => row.type !== 'context') ?? lines[0];
		return line?.newLineNumber ?? line?.oldLineNumber ?? null;
	});

	function openInDiff(): void {
		if (!view || view.kind === 'text') return;
		lightbox = false;
		onOpenInDiff?.(view.file, target);
	}
</script>

{#snippet fileName()}
	<span class="evidence-file" title={view && view.kind !== 'text' ? view.file : undefined}>
		<img src={fileIconUrl(name)} alt="" width="14" height="14" class="evidence-file-icon" />
		<span class="evidence-file-name">{name}</span>
	</span>
{/snippet}

{#snippet rows()}
	{#each lines as line, i (i)}
		<FileDiff.Row type={line.type} oldLine={line.oldLineNumber} newLine={line.newLineNumber} code={line.content} />
	{/each}
{/snippet}

{#if view && view.kind !== 'text'}
	<FileDiff.Root class="focus-evidence" file={view.file} lang={langForPath(view.file)} {additions} {deletions} data-single-gutter={singleGutter || undefined} aria-label="Evidence">
		<FileDiff.TopBar class="focus-evidence-head">
			<span class="focus-evidence-label">Evidence</span>
			{@render fileName()}
			{#if view.kind === 'diff'}<FileDiff.PlusMinus />{:else if range}<span class="focus-evidence-range">{range}</span>{/if}
			<span class="focus-evidence-actions">
				{#if onOpenInDiff}<Button variant="ghost" class="evidence-open gap-1.5" onclick={openInDiff}>Open in diff <ArrowUpRight size={13} aria-hidden="true" /></Button>{/if}
				<Button variant="ghost" size="icon" aria-label="View evidence full screen" title="View full screen" onclick={() => (lightbox = true)}><Maximize2 size={13} aria-hidden="true" /></Button>
			</span>
		</FileDiff.TopBar>
		<FileDiff.Content>{@render rows()}</FileDiff.Content>
	</FileDiff.Root>

	<Modal.Root bind:open={lightbox}>
		<Modal.Content size="xl" class="fix-review-modal evidence-lightbox" aria-label="Evidence" surfaceClass="!p-0 !gap-0">
			<Modal.Header class="fix-review-head">
				<Modal.Title class="fix-review-title">Evidence</Modal.Title>
				{@render fileName()}
				<span class="fix-review-meta">
					{#if view.kind === 'diff'}{#if additions}<span class="text-success">+{additions}</span>{/if}{#if deletions}<span class="text-danger">−{deletions}</span>{/if}{:else if range}{range}{/if}
				</span>
				{#if onOpenInDiff}<Button variant="ghost" class="ms-auto gap-1.5" onclick={openInDiff}>Open in diff <ArrowUpRight size={13} aria-hidden="true" /></Button>{/if}
			</Modal.Header>
			<FileDiff.Root class="evidence-lightbox-diff" file={view.file} lang={langForPath(view.file)} {additions} {deletions} data-single-gutter={singleGutter || undefined}>
				<FileDiff.Content>{@render rows()}</FileDiff.Content>
			</FileDiff.Root>
		</Modal.Content>
	</Modal.Root>
{:else if view}
	<div class="focus-evidence">
		<div class="focus-evidence-head"><span class="focus-evidence-label">Evidence</span><span class="focus-evidence-command" title={tool.command}>{tool.command}</span></div>
		<ScrollArea class="max-h-56" showCues={false} aria-label="Evidence">
			<CodeBlock code={view.text} lang="plaintext" copy="overlay" class="focus-evidence-code" />
		</ScrollArea>
	</div>
{/if}
