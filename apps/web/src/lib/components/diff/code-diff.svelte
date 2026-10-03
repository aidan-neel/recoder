<script lang="ts">
	import { tick } from 'svelte';
	import { Button } from '@sivir-ui/svelte/components/button';
	import * as Typography from '@sivir-ui/svelte/components/typography';
	import type { DiffLine, FileDiff } from '$lib/diff/diff';
	import type { ReviewCodeContext } from '@recoder/shared';
	import type { Finding } from '$lib/findings/findings.svelte';
	import { SEVERITY_DOT, findingsStore } from '$lib/findings/findings.svelte';
	import { highlightLines } from '$lib/diff/highlight';
	import {
		flattenLines,
		groupByEndLine,
		hunkOffsets as offsetsOf,
		rowTint,
		splitRows as splitRowsOf,
		strongestPerLine,
		withSkipped
	} from '$lib/diff/diff-rows';
	import { askContext, inRange, lineDraft, rangeDraft, type PendingNote } from '$lib/diff/note-draft';
	import { notesStore, type ReviewNote } from '$lib/findings/notes.svelte';
	import DiffAttachments from './diff-attachments.svelte';
	import DiffNotePopover from './diff-note-popover.svelte';

	interface Props {
		diff: FileDiff;
		findings?: Finding[];
		onAsk?: (context: ReviewCodeContext) => void;
		mode?: 'unified' | 'split';
		/** Off for the focused-hunk card, where the finding sits beside the code. */
		cards?: boolean;
		/** Range attached to the chat composer; its rows stay tinted after the text selection clears. */
		activeRange?: ReviewCodeContext | null;
		/** A plain click in the code (no drag) lets go of the attached range. */
		onClearRange?: () => void;
		/** Preview only (e.g. a suggested fix): no selection, notes or line actions. */
		readonly?: boolean;
	}

	let {
		diff,
		findings = [],
		onAsk,
		mode = 'unified',
		cards = true,
		activeRange = null,
		onClearRange,
		readonly = false
	}: Props = $props();

	const hunkOffsets = $derived(offsetsOf(diff));
	const splitRows = $derived(diff.hunks.map(splitRowsOf));
	const hunks = $derived(withSkipped(diff));

	/** Per-line highlighted HTML, aligned 1:1 with hunks → lines. */
	const highlighted = $derived(diff.hunks.map((h) => highlightLines(h.lines.map((l) => l.text))));

	const flatLines = $derived(flattenLines(diff));
	const byLine = $derived(groupByEndLine(findings));
	const lineMarks = $derived(strongestPerLine(findings));
	const fileNotes = $derived(notesStore.forFile(diff.path));
	const notesByNewLine = $derived(groupByEndLine(fileNotes.filter((note) => note.side === 'new')));
	const notesByOldLine = $derived(groupByEndLine(fileNotes.filter((note) => note.side === 'old')));

	function notesForRow(line: DiffLine): ReviewNote[] {
		const list: ReviewNote[] = [];

		if (line.newNo !== null) list.push(...(notesByNewLine.get(line.newNo) ?? []));
		if (line.oldNo !== null) list.push(...(notesByOldLine.get(line.oldNo) ?? []));

		return list;
	}

	function noteCountForRow(line: DiffLine): number {
		return (
			(line.newNo !== null ? (notesByNewLine.get(line.newNo)?.length ?? 0) : 0) +
			(line.oldNo !== null ? (notesByOldLine.get(line.oldNo)?.length ?? 0) : 0)
		);
	}

	let rootEl: HTMLElement | undefined = $state();
	let pending = $state<PendingNote | null>(null);
	let popoverOpen = $state(false);
	let anchorTop = $state(0);
	let anchorLeft = $state(0);

	/** True while the pointer is down, so a pause mid-drag never commits. */
	let pointerDown = false;

	/** Where a press on the code started; a release within a few px is a click. */
	let pressAt: { x: number; y: number } | null = null;

	function onPointerDown(event: PointerEvent): void {
		const target = event.target as HTMLElement | null;

		if (target?.closest('[data-note-composer], button, a, input, textarea, select, [role="button"]')) return;
		pressAt = target?.closest('[data-diff-row]') ? { x: event.clientX, y: event.clientY } : null;
		pointerDown = true;
		findingsStore.suppressHover = true;
	}

	/** A drag ends anywhere; only then may a selection commit. A plain click lets go of the attached range. */
	function onPointerRelease(event: PointerEvent): void {
		if (!pointerDown) return;
		pointerDown = false;
		findingsStore.suppressHover = false;

		const click = pressAt && Math.hypot(event.clientX - pressAt.x, event.clientY - pressAt.y) < 4;

		pressAt = null;

		if (click && activeRange && window.getSelection()?.isCollapsed !== false) {
			onClearRange?.();

			return;
		}

		scheduleSelection();
	}

	/** Hovering a row highlights its finding, except mid-drag while a selection is being made. */
	function hoverFinding(id: string | null): void {
		if (!findingsStore.suppressHover) findingsStore.hoveredId = id;
	}

	let selectionTimer: ReturnType<typeof setTimeout> | undefined;

	/** Wait a beat so double/triple-click, select-all, and drags settle first. */
	function scheduleSelection(): void {
		if (popoverOpen || pointerDown) return;
		clearTimeout(selectionTimer);
		selectionTimer = setTimeout(commitSelection, 160);
	}

	/**
	 * With a chat, the draft goes straight into its composer as a quote; notes come from the model when
	 * asked. Without one, the note popover opens.
	 */
	function present(draft: PendingNote): void {
		if (onAsk) {
			pending = null;
			onAsk(askContext(draft));

			return;
		}

		pending = draft;
		popoverOpen = true;
	}

	function commitSelection(): void {
		selectionTimer = undefined;
		if (readonly) return;
		if (pointerDown || !rootEl) return;

		const selection = window.getSelection();

		if (!selection || selection.isCollapsed || selection.rangeCount === 0) return;

		const range = selection.getRangeAt(0);

		if (!rootEl.contains(range.startContainer) || !rootEl.contains(range.endContainer)) return;

		const cells = Array.from(rootEl.querySelectorAll<HTMLElement>('[data-flat]')).filter((cell) =>
			range.intersectsNode(cell)
		);

		if (cells.length === 0) return;

		const indexes = cells.map((cell) => Number(cell.dataset.flat));
		const draft = rangeDraft(flatLines, Math.min(...indexes), Math.max(...indexes), diff.path);

		if (!draft) return;

		const rootRect = rootEl.getBoundingClientRect();
		const rangeRect = range.getBoundingClientRect();
		const lastRow = cells.at(-1)!.closest<HTMLElement>('[data-diff-row]') ?? cells.at(-1)!;

		anchorTop = lastRow.offsetTop + lastRow.offsetHeight - 2;
		anchorLeft = Math.max(0, rangeRect.left - rootRect.left);
		present(draft);
	}

	/** Waits for the popover to restore focus before the discussion takes it. */
	async function askAboutSelection(): Promise<void> {
		if (!pending || !onAsk) return;

		const context = askContext(pending);

		popoverOpen = false;
		window.getSelection()?.removeAllRanges();
		await tick();
		onAsk?.(context);
	}

	/** Line controls provide a keyboard/touch alternative to highlighting text. */
	function selectLine(line: DiffLine, target: HTMLElement): void {
		const row = target.closest<HTMLElement>('[data-diff-row]');

		if (!rootEl || !row) return;

		const draft = lineDraft(flatLines, line, diff.path);

		if (!draft) return;
		anchorTop = row.offsetTop + row.offsetHeight;
		anchorLeft = 0;
		present(draft);
	}

	/** True for rows in the range the open composer is anchored to. */
	function isPendingRow(line: DiffLine): boolean {
		if (activeRange && activeRange.file === diff.path && inRange(line, activeRange)) return true;

		return popoverOpen && !!pending && inRange(line, pending);
	}

	function openEdit(note: ReviewNote): void {
		const card = (document.getElementById(`note-${note.id}`) as HTMLElement | null) ?? rootEl ?? null;

		if (rootEl && card) {
			const rootRect = rootEl.getBoundingClientRect();
			const cardRect = card.getBoundingClientRect();

			anchorTop = cardRect.bottom - rootRect.top;
			anchorLeft = Math.max(0, cardRect.left - rootRect.left);
		}

		pending = {
			mode: 'edit',
			id: note.id,
			file: note.file,
			startLine: note.startLine,
			endLine: note.endLine,
			side: note.side,
			quote: note.quote
		};

		popoverOpen = true;
	}

	function saveNote(body: string): void {
		const current = pending;

		if (!current) return;

		const text = body.trim();

		if (!text) return;

		if (current.mode === 'edit' && current.id) {
			notesStore.update(current.id, text);
		} else {
			notesStore.add({
				file: current.file,
				startLine: current.startLine,
				endLine: current.endLine,
				side: current.side,
				quote: current.quote,
				body: text,
				newText: current.newText,
				oldText: current.oldText,
				diffContext: current.diffContext,
				hunkHeader: current.hunkHeader
			});
		}

		popoverOpen = false;
	}

	$effect(() => {
		document.addEventListener('selectionchange', scheduleSelection);

		return () => {
			document.removeEventListener('selectionchange', scheduleSelection);
			clearTimeout(selectionTimer);
		};
	});

	$effect(() => {
		window.addEventListener('pointerup', onPointerRelease);
		window.addEventListener('pointercancel', onPointerRelease);

		return () => {
			window.removeEventListener('pointerup', onPointerRelease);
			window.removeEventListener('pointercancel', onPointerRelease);
		};
	});
</script>

{#snippet number(line: DiffLine, side: 'old' | 'new', mark: Finding | undefined)}
	{@const n = side === 'old' ? line.oldNo : line.newNo}
	{@const selectable = side === 'new' ? n !== null : line.newNo === null && n !== null}
	{#if selectable && !readonly}
		<Button
			unstyled
			class="diff-num"
			style={mark && side === 'new' ? `color: ${SEVERITY_DOT[mark.severity]}` : undefined}
			aria-label={side === 'new' ? `Discuss line ${n}` : `Discuss deleted line ${n}`}
			onclick={(event: MouseEvent) => selectLine(line, event.currentTarget as HTMLElement)}>{n}</Button
		>
	{:else}
		<span class="diff-num" style:color={mark && side === 'new' ? SEVERITY_DOT[mark.severity] : null}>{n ?? ''}</span>
	{/if}
{/snippet}

{#snippet code(line: DiffLine, hi: number, i: number)}
	<span class="diff-sign" aria-hidden="true">{line.type === 'del' ? '-' : line.type === 'add' ? '+' : ''}</span>
	<!-- eslint-disable-next-line svelte/no-at-html-tags -- highlightLines escapes every token -->
	<span class="diff-code" data-flat={hunkOffsets[hi] + i}>{@html highlighted[hi][i]}</span>
{/snippet}

{#snippet attachments(line: DiffLine, key: number)}
	<DiffAttachments notes={notesForRow(line)} findings={byLine.get(key) ?? []} {cards} onEdit={openEdit} />
{/snippet}

<div bind:this={rootEl} class="review-file-diff relative min-w-0" data-mode={mode}>
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="diff-lines" onpointerdown={onPointerDown}>
		{#each hunks as { hunk, skipped }, hi (hi)}
			{#if skipped > 0}
				<div class="diff-skip"><span>{skipped} unchanged {skipped === 1 ? 'line' : 'lines'}</span></div>
			{/if}
			{#if mode === 'split'}
				{#each splitRows[hi] as row, r (r)}
					{@const right = row.right?.line}
					{@const mark = right?.newNo != null ? lineMarks.get(right.newNo) : undefined}
					<div
						role="row"
						tabindex="-1"
						data-diff-row
						class="diff-row diff-split-row"
						data-new-no={right?.newNo ?? ''}
						data-old-no={row.left?.line.oldNo ?? ''}
						style:box-shadow={mark ? `inset 2px 0 0 ${SEVERITY_DOT[mark.severity]}` : null}
						style:--row-tint={mark ? rowTint(SEVERITY_DOT[mark.severity], 12) : null}
						onmouseenter={() => hoverFinding(mark?.id ?? null)}
						onmouseleave={() => (findingsStore.hoveredId = null)}
					>
						<div
							class="diff-half"
							data-type={row.left ? (row.left.line.type === 'context' ? 'context' : 'del') : 'empty'}
						>
							{#if row.left}{@render number(row.left.line, 'old', undefined)}{@render code(
									row.left.line,
									hi,
									row.left.i
								)}{/if}
						</div>
						<div
							class="diff-half"
							data-type={row.right ? (row.right.line.type === 'context' ? 'context' : 'add') : 'empty'}
						>
							{#if row.right}{@render number(row.right.line, 'new', mark)}{@render code(
									row.right.line,
									hi,
									row.right.i
								)}{/if}
						</div>
					</div>
					{#if row.right}{@render attachments(
							row.right.line,
							row.right.line.newNo ?? -1
						)}{:else if row.left}{@render attachments(row.left.line, -1)}{/if}
				{/each}
			{:else}
				{#each hunk.lines as line, i (`${line.oldNo}-${line.newNo}-${i}`)}
					{@const key = line.newNo ?? -1}
					{@const mark = lineMarks.get(key)}
					{@const noteCount = noteCountForRow(line)}
					<div
						role="row"
						tabindex="-1"
						data-diff-row
						data-type={line.type}
						data-new-no={line.newNo ?? ''}
						data-old-no={line.oldNo ?? ''}
						class="diff-row"
						data-pending={isPendingRow(line) || undefined}
						style:box-shadow={isPendingRow(line)
							? 'inset 3px 0 0 var(--selection-bar)'
							: mark
								? `inset 2px 0 0 ${SEVERITY_DOT[mark.severity]}`
								: noteCount > 0
									? 'inset 2px 0 0 var(--selection-bar)'
									: null}
						style:--row-tint={isPendingRow(line)
							? rowTint('var(--selection-bar)', 16)
							: mark
								? rowTint(SEVERITY_DOT[mark.severity], 12)
								: noteCount > 0
									? rowTint('var(--selection-bar)', 12)
									: null}
						onmouseenter={() => hoverFinding(mark?.id ?? null)}
						onmouseleave={() => (findingsStore.hoveredId = null)}
					>
						{@render number(line, 'old', mark)}
						{@render number(line, 'new', mark)}
						{@render code(line, hi, i)}
					</div>
					{@render attachments(line, key)}
				{/each}
			{/if}
		{/each}
		{#if hunks.length === 0}<Typography.Text class="px-5 py-3 text-sm text-fg-muted"
				>No text changes to display for this file.</Typography.Text
			>{/if}
	</div>

	<DiffNotePopover
		bind:open={popoverOpen}
		{pending}
		{anchorTop}
		{anchorLeft}
		onAsk={onAsk ? askAboutSelection : undefined}
		onSave={saveNote}
	/>
</div>
