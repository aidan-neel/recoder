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
	import { getFileIcon } from '$lib/file-icons';
	import { notesStore, type ReviewNote } from '$lib/notes.svelte';
	import FindingCard from './finding-card.svelte';
	import NoteComposer from './note-composer.svelte';

	interface Props {
		diff: FileDiff;
		findings?: Finding[];
		onAsk?: (context: ReviewCodeContext) => void;
	}

	let { diff, findings = [], onAsk }: Props = $props();

	/** Hunks annotated with how many unchanged lines were skipped before them. */
	const hunks = $derived(
		diff.hunks.map((hunk, i) => {
			const prev = diff.hunks[i - 1];
			const prevEnd = prev ? prev.oldStart + prev.oldCount : hunk.oldStart;
			return { hunk, skipped: Math.max(0, hunk.oldStart - prevEnd) };
		})
	);

	const rowBg: Record<DiffLine['type'], string> = {
		context: '',
		add: 'bg-success/10',
		del: 'bg-error/10'
	};

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

	function marker(line: DiffLine): string {
		return line.type === 'add' ? '+' : line.type === 'del' ? '-' : ' ';
	}

	function cap(text: string, max = 4000): string {
		const suffix = '\n…[truncated]';
		return text.length > max ? text.slice(0, max - suffix.length) + suffix : text;
	}

	/** True while the pointer is down, so a pause mid-drag never commits. */
	let pointerDown = false;

	function onPointerDown(event: PointerEvent): void {
		const target = event.target as HTMLElement | null;
		if (
			target?.closest(
				'[data-note-composer], button, a, input, textarea, select, [role="button"]'
			)
		) return;
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
		if (pointerDown || !rootEl) return;
		const selection = window.getSelection();
		if (!selection || selection.isCollapsed || selection.rangeCount === 0) return;
		const range = selection.getRangeAt(0);
		if (!rootEl.contains(range.startContainer) || !rootEl.contains(range.endContainer)) return;
		const rows = Array.from(rootEl.querySelectorAll<HTMLElement>('[data-diff-row]'));
		let from = -1;
		let to = -1;
		rows.forEach((row, i) => {
			if (range.intersectsNode(row)) {
				if (from < 0) from = i;
				to = i;
			}
		});
		if (from < 0 || to < 0) return;
		const slice = flatLines.slice(from, to + 1);
		const newNos = slice.map(({ line }) => line.newNo).filter((n): n is number => n !== null);
		const oldNos = slice.map(({ line }) => line.oldNo).filter((n): n is number => n !== null);
		const side: 'old' | 'new' = newNos.length > 0 ? 'new' : 'old';
		const lines = side === 'new' ? newNos : oldNos;
		if (lines.length === 0) return;

		const context = flatLines.slice(Math.max(0, from - 3), Math.min(flatLines.length, to + 4));
		const rootRect = rootEl.getBoundingClientRect();
		const rangeRect = range.getBoundingClientRect();
		const lastRow = rows[to];
		anchorTop = lastRow.offsetTop + lastRow.offsetHeight - 2;
		anchorLeft = Math.max(0, rangeRect.left - rootRect.left);
		pending = {
			mode: 'create',
			file: diff.path,
			startLine: Math.min(...lines),
			endLine: Math.max(...lines),
			side,
			quote: range.toString().trim().slice(0, 2000),
			newText: cap(slice.filter(({ line }) => line.newNo !== null).map(({ line }) => line.text).join('\n')),
			oldText: cap(slice.filter(({ line }) => line.oldNo !== null).map(({ line }) => line.text).join('\n')),
			diffContext: cap(context.map(({ line }) => `${marker(line)}${line.text}`).join('\n')),
			hunkHeader: slice[slice.length - 1]?.hunk.header
		};
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
		popoverOpen = true;
	}

	/** True for rows in the range the open composer is anchored to. */
	function isPendingRow(line: DiffLine): boolean {
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
		const release = () => {
			if (!pointerDown) return;
			pointerDown = false;
			findingsStore.suppressHover = false;
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

<div bind:this={rootEl} class="review-file-diff relative flex min-w-0 flex-col gap-2">
	<div class="flex min-h-9 shrink-0 items-center gap-2">
		<span class="flex shrink-0 items-center [&>svg]:size-4" aria-hidden="true">{@html getFileIcon(diff.path)}</span>
		<Typography.Metadata class="min-w-0 truncate font-mono text-sm font-medium text-foreground" title={diff.path}>{diff.path.split('/').at(-1)}</Typography.Metadata>
		<span class="shrink-0 font-mono text-xs">
			<span class="text-success">+{diff.additions}</span>
			{' '}
			<span class="text-error">−{diff.deletions}</span>
		</span>
		{#if fileNotes.length > 0}
			<span class="ml-auto flex shrink-0 items-center gap-1.5 text-[13px] text-info">
				<MessageSquare size={14} aria-hidden="true" />
				{fileNotes.length}
			</span>
		{/if}
	</div>
	<Card.Root class="overflow-hidden rounded-xl border border-border bg-transparent !p-0 shadow-none">
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="py-3 font-mono text-sm leading-6"
		onpointerdown={onPointerDown}
	>
		{#each hunks as { hunk, skipped }, hi (hi)}
			{#if skipped > 0}
				<div
					class="flex items-center gap-3 px-4 py-1.5 text-[13px] text-foreground-muted/70 select-none"
				>
					<span class="h-px flex-1 bg-border/60"></span>
					<span class="font-mono">
						{skipped} unchanged {skipped === 1 ? 'line' : 'lines'}
					</span>
					<span class="h-px flex-1 bg-border/60"></span>
				</div>
			{/if}
			{#each hunk.lines as line, i (`${line.oldNo}-${line.newNo}-${i}`)}
				{@const key = line.newNo ?? -1}
				{@const mark = lineMarks.get(key)}
				{@const hovered = mark && findingsStore.hoveredId === mark.id}
				{@const noteCount = noteCountForRow(line)}
				<div
					role="row"
					tabindex="-1"
					data-diff-row
					data-new-no={line.newNo ?? ''}
					data-old-no={line.oldNo ?? ''}
					class="grid w-full grid-cols-[2.75rem_2.75rem_minmax(0,1fr)] {rowBg[line.type]}"
					style:box-shadow={isPendingRow(line)
						? 'inset 3px 0 0 var(--color-info)'
						: mark
							? `inset ${hovered ? 3 : 2}px 0 0 ${SEVERITY_DOT[mark.severity]}`
							: noteCount > 0
								? 'inset 2px 0 0 var(--color-info)'
								: null}
					onmouseenter={() => {
						if (!findingsStore.suppressHover) findingsStore.hoveredId = mark?.id ?? null;
					}}
					onmouseleave={() => (findingsStore.hoveredId = null)}
				>
					{#if line.newNo === null}
						<Button variant="ghost" size="sm" class="!h-6 !min-h-6 !justify-end rounded-none !py-0 !pe-3 !ps-0 font-mono text-xs !font-normal text-foreground-muted" aria-label={`Discuss deleted line ${line.oldNo}`} title="Discuss this deleted line" onclick={(event: MouseEvent) => selectLine(line, event.currentTarget as HTMLElement)}>{line.oldNo}</Button>
					{:else}<span
						class="pr-3 text-right text-foreground-muted/60 select-none"
						style:color={mark ? SEVERITY_DOT[mark.severity] : null}
					>
						{line.oldNo ?? ''}
					</span>{/if}
					{#if line.newNo !== null}<Button variant="ghost" size="sm" class="!h-6 !min-h-6 !justify-end rounded-none !py-0 !pe-3 !ps-0 font-mono text-xs !font-normal text-foreground-muted" aria-label={`Discuss line ${line.newNo}`} title="Discuss this line" onclick={(event: MouseEvent) => selectLine(line, event.currentTarget as HTMLElement)}>{line.newNo}</Button>{:else}<span></span>{/if}
					<span class="pr-4 whitespace-pre-wrap break-all min-w-0">
						{#if line.type === 'del'}
							<span class="mr-1 inline-block w-3 shrink-0 text-center text-error select-none">-</span>{@html highlighted[hi][i]}
						{:else if line.type === 'add'}
							<span class="mr-1 inline-block w-3 shrink-0 text-center text-success select-none">+</span>{@html highlighted[hi][i]}
						{:else}
							<span class="mr-1 inline-block w-3 shrink-0 text-center text-foreground-muted/40 select-none">{' '}</span>{@html highlighted[hi][i]}
						{/if}
					</span>
				</div>
				{#each notesForRow(line) as note (note.id)}
					<div
						id={`note-${note.id}`}
						data-note-card
						class="mx-3 my-3 scroll-mt-3 sm:ms-[5.5rem] {findingsStore.suppressHover
							? 'pointer-events-none'
							: ''}"
					>
						<article>
						<Card.Root class="p-3 font-sans">
							<div class="flex items-center gap-2 font-mono text-[14px]">
								<Badge variant="info">Note</Badge>
								<span class="min-w-0 flex-1 truncate text-foreground-muted">
									{note.file}:{note.startLine === note.endLine
										? note.startLine
										: `${note.startLine}-${note.endLine}`}
								</span>
								<Button
									variant="ghost"
									size="icon"
									class="shrink-0"
									aria-label="Edit note"
									onclick={() => openEdit(note)}
								>
									<Pencil size={13} />
								</Button>
							</div>
							{#if note.quote}
								<CodeBlock code={note.quote} lang="plaintext" copy="overlay" class="mt-2 max-h-32" />
							{/if}
							<div class="mt-1.5 min-w-0">
								<Markdown content={note.body} />
							</div>
						</Card.Root>
						</article>
					</div>
				{/each}
				{#each byLine.get(key) ?? [] as finding (finding.id)}
					<div
						id={`finding-${finding.id}`}
						class="mx-3 my-3 scroll-mt-3 sm:ms-[5.5rem] {findingsStore.suppressHover
							? 'pointer-events-none'
							: ''}"
					>
						<FindingCard {finding} />
					</div>
				{/each}
			{/each}
		{/each}
		{#if hunks.length === 0}<Typography.Text class="px-4 py-3 text-sm text-foreground-muted">No text changes to display for this file.</Typography.Text>{/if}
	</div>
	</Card.Root>

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
