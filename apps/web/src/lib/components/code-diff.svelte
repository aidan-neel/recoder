<script lang="ts">
	import { tick } from 'svelte';
	import MessageSquare from '@lucide/svelte/icons/message-square';
	import Pencil from '@lucide/svelte/icons/pencil';
	import { Button } from '@sivir-ui/svelte/components/button';
	import { Badge } from '@sivir-ui/svelte/components/badge';
	import * as Card from '@sivir-ui/svelte/components/card';
	import { CodeBlock } from '@sivir-ui/svelte/components/code-block';
	import { Markdown } from '@sivir-ui/svelte/components/markdown';
	import * as Typography from '@sivir-ui/svelte/components/typography';
	import * as Popover from '@sivir-ui/svelte/components/popover';
	import type { DiffLine, FileDiff } from '$lib/diff';
	import type { ReviewCodeContext } from '@recoder/shared';
	import type { Finding, FindingSeverity } from '$lib/findings.svelte';
	import { SEVERITY_DOT, findingsStore } from '$lib/findings.svelte';
	import { highlightLines } from '$lib/highlight';
	import { notesStore, type ReviewNote } from '$lib/notes.svelte';
	import FindingCard from './finding-card.svelte';
	import { collapse } from '$lib/collapse';
	import NoteComposer from './note-composer.svelte';

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

	let { diff, findings = [], onAsk, mode = 'unified', cards = true, activeRange = null, onClearRange, readonly = false }: Props = $props();

	/** Index of each hunk's first line within `flatLines`. */
	const hunkOffsets = $derived(diff.hunks.reduce<number[]>((acc, hunk, i) => {
		acc.push(i === 0 ? 0 : acc[i - 1] + diff.hunks[i - 1].lines.length);
		return acc;
	}, []));

	interface SplitCell { line: DiffLine; i: number }
	/** Side-by-side rows: context on both sides, deletions paired with the additions that follow. */
	const splitRows = $derived(diff.hunks.map((hunk) => {
		const rows: { left: SplitCell | null; right: SplitCell | null }[] = [];
		let dels: SplitCell[] = [];
		let adds: SplitCell[] = [];
		const flush = () => {
			for (let k = 0; k < Math.max(dels.length, adds.length); k++) rows.push({ left: dels[k] ?? null, right: adds[k] ?? null });
			dels = [];
			adds = [];
		};
		hunk.lines.forEach((line, i) => {
			if (line.type === 'del') { if (adds.length) flush(); dels.push({ line, i }); }
			else if (line.type === 'add') adds.push({ line, i });
			else { flush(); rows.push({ left: { line, i }, right: { line, i } }); }
		});
		flush();
		return rows;
	}));

	/** Hunks annotated with how many unchanged lines were skipped before them. */
	const hunks = $derived(
		diff.hunks.map((hunk, i) => {
			const prev = diff.hunks[i - 1];
			const prevEnd = prev ? prev.oldStart + prev.oldCount : hunk.oldStart;
			return { hunk, skipped: Math.max(0, hunk.oldStart - prevEnd) };
		})
	);

	/** Per-line highlighted HTML, aligned 1:1 with hunks → lines. */
	const highlighted = $derived(
		diff.hunks.map((h) => highlightLines(h.lines.map((l) => l.text)))
	);

	/** Flat line list with its hunk, aligned 1:1 with rendered diff rows. */
	const flatLines = $derived(
		diff.hunks.flatMap((hunk) => hunk.lines.map((line) => ({ line, hunk })))
	);

	/** Open findings grouped by the line their card anchors under. */
	const byLine = $derived.by(() => {
		const map = new Map<number, Finding[]>();
		for (const finding of findings) {
			const list = map.get(finding.endLine) ?? [];
			list.push(finding);
			map.set(finding.endLine, list);
		}
		return map;
	});

	/** Strongest open finding per new-side line, for row markers. */
	const lineMarks = $derived.by(() => {
		const rank: Record<FindingSeverity, number> = { high: 0, medium: 1, low: 2, info: 3 };
		const map = new Map<number, Finding>();
		for (const finding of findings) {
			if (finding.status === 'dismissed') continue;
			for (let n = finding.startLine; n <= finding.endLine; n++) {
				const current = map.get(n);
				if (!current || rank[finding.severity] < rank[current.severity]) {
					map.set(n, finding);
				}
			}
		}
		return map;
	});

	const fileNotes = $derived(notesStore.forFile(diff.path));

	/** Notes grouped by the line their card renders under, keyed per diff side. */
	const notesByNewLine = $derived.by(() => {
		const map = new Map<number, ReviewNote[]>();
		for (const note of fileNotes) {
			if (note.side !== 'new') continue;
			const list = map.get(note.endLine) ?? [];
			list.push(note);
			map.set(note.endLine, list);
		}
		return map;
	});
	const notesByOldLine = $derived.by(() => {
		const map = new Map<number, ReviewNote[]>();
		for (const note of fileNotes) {
			if (note.side !== 'old') continue;
			const list = map.get(note.endLine) ?? [];
			list.push(note);
			map.set(note.endLine, list);
		}
		return map;
	});

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

	interface PendingNote {
		mode: 'create' | 'edit';
		id?: string;
		file: string;
		startLine: number;
		endLine: number;
		side: 'old' | 'new';
		quote: string;
		newText?: string;
		oldText?: string;
		diffContext?: string;
		hunkHeader?: string;
	}

	let rootEl: HTMLElement | undefined = $state();
	let pending = $state<PendingNote | null>(null);
	let popoverOpen = $state(false);
	let anchorTop = $state(0);
	let anchorLeft = $state(0);

	/** Full-row wash for highlighted lines (findings, notes, the selected range). */
	function rowTint(color: string, percent: number): string {
		return `color-mix(in oklab, ${color} ${percent}%, transparent)`;
	}

	function marker(line: DiffLine): string {
		return line.type === 'add' ? '+' : line.type === 'del' ? '-' : ' ';
	}

	function cap(text: string, max = 4000): string {
		const suffix = '\n…[truncated]';
		return text.length > max ? text.slice(0, max - suffix.length) + suffix : text;
	}

	/** True while the pointer is down, so a pause mid-drag never commits. */
	let pointerDown = false;
	/** Where a press on the code started; a release within a few px is a click. */
	let pressAt: { x: number; y: number } | null = null;

	function onPointerDown(event: PointerEvent): void {
		const target = event.target as HTMLElement | null;
		if (
			target?.closest(
				'[data-note-composer], button, a, input, textarea, select, [role="button"]'
			)
		) return;
		pressAt = target?.closest('[data-diff-row]') ? { x: event.clientX, y: event.clientY } : null;
		pointerDown = true;
		findingsStore.suppressHover = true;
	}

	let selectionTimer: ReturnType<typeof setTimeout> | undefined;

	/** Wait a beat so double/triple-click, select-all, and drags settle first. */
	function scheduleSelection(): void {
		if (popoverOpen || pointerDown) return;
		clearTimeout(selectionTimer);
		selectionTimer = setTimeout(commitSelection, 160);
	}

	function commitSelection(): void {
		selectionTimer = undefined;
		if (readonly) return;
		if (pointerDown || !rootEl) return;
		const selection = window.getSelection();
		if (!selection || selection.isCollapsed || selection.rangeCount === 0) return;
		const range = selection.getRangeAt(0);
		if (!rootEl.contains(range.startContainer) || !rootEl.contains(range.endContainer)) return;
		const cells = Array.from(rootEl.querySelectorAll<HTMLElement>('[data-flat]')).filter((cell) => range.intersectsNode(cell));
		if (cells.length === 0) return;
		const indexes = cells.map((cell) => Number(cell.dataset.flat));
		const from = Math.min(...indexes);
		const to = Math.max(...indexes);
		const slice = flatLines.slice(from, to + 1);
		const newNos = slice.map(({ line }) => line.newNo).filter((n): n is number => n !== null);
		const oldNos = slice.map(({ line }) => line.oldNo).filter((n): n is number => n !== null);
		const side: 'old' | 'new' = newNos.length > 0 ? 'new' : 'old';
		const lines = side === 'new' ? newNos : oldNos;
		if (lines.length === 0) return;

		const context = flatLines.slice(Math.max(0, from - 3), Math.min(flatLines.length, to + 4));
		const rootRect = rootEl.getBoundingClientRect();
		const rangeRect = range.getBoundingClientRect();
		const lastRow = cells.at(-1)!.closest<HTMLElement>('[data-diff-row]') ?? cells.at(-1)!;
		anchorTop = lastRow.offsetTop + lastRow.offsetHeight - 2;
		anchorLeft = Math.max(0, rangeRect.left - rootRect.left);
		pending = {
			mode: 'create',
			file: diff.path,
			startLine: Math.min(...lines),
			endLine: Math.max(...lines),
			side,
			// Whole lines on the chosen side, not the raw selection (which carries gutter numbers and partial lines).
			quote: slice.filter(({ line }) => (side === 'new' ? line.newNo : line.oldNo) !== null).map(({ line }) => line.text).join('\n').slice(0, 2000),
			newText: cap(slice.filter(({ line }) => line.newNo !== null).map(({ line }) => line.text).join('\n')),
			oldText: cap(slice.filter(({ line }) => line.oldNo !== null).map(({ line }) => line.text).join('\n')),
			diffContext: cap(context.map(({ line }) => `${marker(line)}${line.text}`).join('\n')),
			hunkHeader: slice[slice.length - 1]?.hunk.header
		};
		// With a chat, the selection goes straight into its composer as a quote;
		// notes come from the model when asked. Without one, keep the note popover.
		if (onAsk) {
			const { file, startLine, endLine, side, quote, diffContext } = pending;
			pending = null;
			onAsk({ file, startLine, endLine, side, quote, diffContext });
			return;
		}
		popoverOpen = true;
	}

	async function askAboutSelection(): Promise<void> {
		if (!pending || !onAsk) return;
		const { file, startLine, endLine, side, quote, diffContext } = pending;
		popoverOpen = false;
		window.getSelection()?.removeAllRanges();
		// Wait for the popover to restore focus before focusing the discussion.
		await tick();
		onAsk?.({ file, startLine, endLine, side, quote, diffContext });
	}

	/** Line controls provide a keyboard/touch alternative to highlighting text. */
	function selectLine(line: DiffLine, target: HTMLElement): void {
		const row = target.closest<HTMLElement>('[data-diff-row]');
		if (!rootEl || !row) return;
		const index = flatLines.findIndex((item) => item.line === line);
		const number = line.newNo ?? line.oldNo;
		if (number === null) return;
		anchorTop = row.offsetTop + row.offsetHeight;
		anchorLeft = 0;
		pending = {
			mode: 'create', file: diff.path, startLine: number, endLine: number,
			side: line.newNo === null ? 'old' : 'new', quote: line.text.slice(0, 2000),
			diffContext: cap(flatLines.slice(Math.max(0, index - 3), index + 4).map(({ line }) => `${marker(line)}${line.text}`).join('\n'))
		};
		if (onAsk) {
			const { file, startLine, endLine, side, quote, diffContext } = pending;
			pending = null;
			onAsk({ file, startLine, endLine, side, quote, diffContext });
			return;
		}
		popoverOpen = true;
	}

	/** True for rows in the range the open composer is anchored to. */
	function isPendingRow(line: DiffLine): boolean {
		if (activeRange && activeRange.file === diff.path) {
			const n = activeRange.side === 'new' ? line.newNo : line.oldNo;
			if (n !== null && n >= activeRange.startLine && n <= activeRange.endLine) return true;
		}
		if (!popoverOpen || !pending) return false;
		if (pending.side === 'new') {
			return line.newNo !== null && line.newNo >= pending.startLine && line.newNo <= pending.endLine;
		}
		return line.oldNo !== null && line.oldNo >= pending.startLine && line.oldNo <= pending.endLine;
	}

	$effect(() => {
		const onSelectionChange = () => scheduleSelection();
		document.addEventListener('selectionchange', onSelectionChange);
		return () => {
			document.removeEventListener('selectionchange', onSelectionChange);
			clearTimeout(selectionTimer);
		};
	});


	function openEdit(note: ReviewNote): void {
		const card =
			(document.getElementById(`note-${note.id}`) as HTMLElement | null) ?? rootEl ?? null;
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

	// A drag ends anywhere; only then may a selection commit.
	$effect(() => {
		const release = (event: PointerEvent) => {
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
		};
		window.addEventListener('pointerup', release);
		window.addEventListener('pointercancel', release);
		return () => {
			window.removeEventListener('pointerup', release);
			window.removeEventListener('pointercancel', release);
		};
	});
</script>

{#snippet number(line: DiffLine, side: 'old' | 'new', mark: Finding | undefined)}
	{@const n = side === 'old' ? line.oldNo : line.newNo}
	{@const selectable = side === 'new' ? n !== null : line.newNo === null && n !== null}
	{#if selectable && !readonly}
		<Button unstyled class="diff-num" style={mark && side === 'new' ? `color: ${SEVERITY_DOT[mark.severity]}` : undefined}
			aria-label={side === 'new' ? `Discuss line ${n}` : `Discuss deleted line ${n}`}
			onclick={(event: MouseEvent) => selectLine(line, event.currentTarget as HTMLElement)}>{n}</Button>
	{:else}
		<span class="diff-num" style:color={mark && side === 'new' ? SEVERITY_DOT[mark.severity] : null}>{n ?? ''}</span>
	{/if}
{/snippet}

{#snippet code(line: DiffLine, hi: number, i: number)}
	<span class="diff-sign" aria-hidden="true">{line.type === 'del' ? '-' : line.type === 'add' ? '+' : ''}</span>
	<span class="diff-code" data-flat={hunkOffsets[hi] + i}>{@html highlighted[hi][i]}</span>
{/snippet}

{#snippet attachments(line: DiffLine, key: number)}
	{#each notesForRow(line) as note (note.id)}
		<div id={`note-${note.id}`} data-note-card class="diff-attachment {findingsStore.suppressHover ? 'pointer-events-none' : ''}">
			<article>
			<Card.Root class="inline-finding">
				<div class="inline-finding-head">
					<Badge variant="info">Note</Badge>
					<span class="min-w-0 flex-1 truncate font-mono">{note.file}:{note.startLine === note.endLine ? note.startLine : `${note.startLine}-${note.endLine}`}</span>
					<Button variant="ghost" size="icon" class="shrink-0" aria-label="Edit note" onclick={() => openEdit(note)}><Pencil size={13} /></Button>
				</div>
				{#if note.quote}<CodeBlock code={note.quote} lang="plaintext" copy="overlay" class="mt-2 max-h-32" />{/if}
				<div class="mt-1.5 min-w-0 text-[13.5px]"><Markdown content={note.body} /></div>
			</Card.Root>
			</article>
		</div>
	{/each}
	{#if cards}
		{#each byLine.get(key) ?? [] as finding (finding.id)}
			<div id={`finding-${finding.id}`} class="diff-attachment {findingsStore.suppressHover ? 'pointer-events-none' : ''}" in:collapse out:collapse>
				<FindingCard {finding} />
			</div>
		{/each}
	{/if}
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
					<div role="row" tabindex="-1" data-diff-row class="diff-row diff-split-row"
						data-new-no={right?.newNo ?? ''} data-old-no={row.left?.line.oldNo ?? ''}
						style:box-shadow={mark ? `inset 2px 0 0 ${SEVERITY_DOT[mark.severity]}` : null}
						style:--row-tint={mark ? rowTint(SEVERITY_DOT[mark.severity], 12) : null}
						onmouseenter={() => { if (!findingsStore.suppressHover) findingsStore.hoveredId = mark?.id ?? null; }}
						onmouseleave={() => (findingsStore.hoveredId = null)}>
						<div class="diff-half" data-type={row.left ? (row.left.line.type === 'context' ? 'context' : 'del') : 'empty'}>
							{#if row.left}{@render number(row.left.line, 'old', undefined)}{@render code(row.left.line, hi, row.left.i)}{/if}
						</div>
						<div class="diff-half" data-type={row.right ? (row.right.line.type === 'context' ? 'context' : 'add') : 'empty'}>
							{#if row.right}{@render number(row.right.line, 'new', mark)}{@render code(row.right.line, hi, row.right.i)}{/if}
						</div>
					</div>
					{#if row.right}{@render attachments(row.right.line, row.right.line.newNo ?? -1)}{:else if row.left}{@render attachments(row.left.line, -1)}{/if}
				{/each}
			{:else}
				{#each hunk.lines as line, i (`${line.oldNo}-${line.newNo}-${i}`)}
					{@const key = line.newNo ?? -1}
					{@const mark = lineMarks.get(key)}
					{@const noteCount = noteCountForRow(line)}
					<div role="row" tabindex="-1" data-diff-row data-type={line.type}
						data-new-no={line.newNo ?? ''} data-old-no={line.oldNo ?? ''}
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
						onmouseenter={() => { if (!findingsStore.suppressHover) findingsStore.hoveredId = mark?.id ?? null; }}
						onmouseleave={() => (findingsStore.hoveredId = null)}>
						{@render number(line, 'old', mark)}
						{@render number(line, 'new', mark)}
						{@render code(line, hi, i)}
					</div>
					{@render attachments(line, key)}
				{/each}
			{/if}
		{/each}
		{#if hunks.length === 0}<Typography.Text class="px-5 py-3 text-sm text-fg-muted">No text changes to display for this file.</Typography.Text>{/if}
	</div>

	<Popover.Root bind:open={popoverOpen} placement="bottom-start" inert={false}>
		<Popover.Trigger
			unstyled
			tabindex={-1}
			aria-label="Review note anchor"
			class="pointer-events-none absolute size-0 min-h-0 min-w-0 overflow-hidden border-0 p-0 opacity-0"
			style="top: {anchorTop}px; left: {anchorLeft}px"
		/>
		<Popover.Content
			aria-label={pending?.mode === 'edit' ? 'Edit review note' : 'Discuss selected code'}
			class="w-[22rem] min-w-0 max-w-[calc(100vw-1rem)]"
			surfaceClass="!gap-3 !p-3"
			lockScroll={false}
		>
			{#if pending}
				<Typography.Metadata class="truncate font-mono text-xs" title={pending.file}>{pending.file.split('/').at(-1)}:{pending.startLine}{pending.endLine !== pending.startLine ? `–${pending.endLine}` : ''} · {pending.side === 'old' ? 'Before' : 'After'}</Typography.Metadata>
				{#if onAsk && pending.mode === 'create'}
					<Button variant="secondary" class="w-full justify-start gap-2 font-normal" onclick={askAboutSelection}><MessageSquare size={15} aria-hidden="true" />Ask about this code</Button>
				{/if}
				<NoteComposer
					initialBody={pending.mode === 'edit' && pending.id
						? (notesStore.items.find((note) => note.id === pending?.id)?.body ?? '')
						: ''}
					placeholder={pending.mode === 'edit' ? 'Edit note…' : 'Leave a note…'}
					onsave={saveNote}
				/>
			{/if}
		</Popover.Content>
	</Popover.Root>
</div>
