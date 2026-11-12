'use client';

import { toast } from '@recoder/ui';
import { GitPullRequest } from 'lucide-react';
import { useCallback, useEffect, useMemo } from 'react';

import { entryAction, entryHref, type QueueEntry } from '@/lib/queue/queue';
import { useQueue } from '@/lib/queue/queue-store';
import { cancelWarm, openRow, warmSoon } from '@/lib/queue/queue-warm';
import { SAMPLE_PULL } from '@/lib/sample/sample-review';
import { pullRef, pullTitle } from '@/lib/shell/format';
import { useShell, type PaletteItem } from '@/lib/shell/shell-store';
import { useKeys } from '@/lib/shell/use-keys';

import { rowActions } from './row-actions';

/** The palette icon's color for a row whose strongest open decision is worth a glance. */
const TONE_COLOR: Partial<Record<string, string>> = {
	high: 'var(--sev-high-solid)',
	medium: 'var(--sev-medium-solid)'
};

function startEntry(entry: QueueEntry): void {
	void useQueue.getState().start(entry);
}

/** The row for an entry key, while it is on the page. */
function rowOf(key: string): HTMLElement | null {
	return document.querySelector<HTMLElement>(`[data-queue-key="${CSS.escape(key)}"]`);
}

/** Focuses the row's title, the control that stands for the row, and leaves the scroll alone. */
function focusTitle(row: HTMLElement): void {
	row.querySelector<HTMLElement>('[data-ui="row-button"]')?.focus({ preventScroll: true });
}

/** Moves focus to the selected row's title when nothing else holds it, so after a visit to a review the keyboard starts where it left off. */
export function focusSelected(): void {
	const key = useQueue.getState().selected;
	const row = key ? rowOf(key) : null;

	if (row && document.activeElement === document.body) focusTitle(row);
}

/**
 * Scrolls a row into view without jumping when it already shows. While focus
 * is in another row (Tab, or a clicked button), it moves to this row's title,
 * so the focus ring and the selection never part, as in the review rail.
 */
function reveal(key: string): void {
	const row = rowOf(key);
	const focused = document.activeElement;

	if (row && focused instanceof HTMLElement && focused.closest('[data-queue-row]') && !row.contains(focused)) {
		focusTitle(row);
	}

	row?.scrollIntoView({ block: 'nearest' });
}

/**
 * Opens the row's review the way a click on its title does (`openRow`), with
 * the row's pull request beside the read, so Enter, the side button, the row
 * menu and the palette all paint the header whole. A row without a review is
 * only selected: a review costs money, so it starts from the row's own button
 * or r, never from Enter or a click on the row. In the sample, it says which
 * review opens.
 */
function openEntry(entry: QueueEntry, sample: boolean): void {
	const href = entryHref(entry, sample);

	if (href) return openRow(entry, href);

	cancelWarm();

	if (sample) {
		toast.info(`Only #${SAMPLE_PULL.number} opens in the sample`, {
			description: 'Track a repository to review your own pull requests.'
		});

		return;
	}

	useQueue.getState().select(entry.key);
	reveal(entry.key);
}

/** One palette row per pull request, in queue order. */
function pullItems(ordered: QueueEntry[], sample: boolean): PaletteItem[] {
	return ordered.map((entry) => ({
		id: entry.key,
		group: 'Pull requests',
		label: pullTitle(entry.pull.title, entry.pull.number),
		detail: pullRef(entry.repo, entry.pull.number),
		keywords: `${entry.repo} ${entry.pull.author} ${entry.pull.headRef} ${entry.pull.number}`,
		icon: GitPullRequest,
		tone: entry.state === 'needs-you' && entry.tone ? TONE_COLOR[entry.tone] : undefined,
		run: () => openEntry(entry, sample)
	}));
}

/**
 * The selected row's menu actions as palette rows, after the pull requests,
 * so a keyboard can reach everything the right-click menu offers.
 */
function selectedItems(
	entry: QueueEntry | null,
	sample: boolean,
	onDelete: (entry: QueueEntry) => void
): PaletteItem[] {
	if (!entry) return [];

	const actions = rowActions(entry, {
		href: entryHref(entry, sample),
		sample,
		starting: false,
		onOpen: (row) => openEntry(row, sample),
		onStart: startEntry,
		onDelete
	});

	return actions
		.filter((action) => action.id !== 'open')
		.map((action) => ({
			id: `selected:${action.id}`,
			group: 'Selected pull request',
			label: action.label,
			detail: pullRef(entry.repo, entry.pull.number),
			icon: action.icon,
			shortcut: action.shortcut,
			run: action.run
		}));
}

/** The selected row of `ordered`, read when a key is pressed. */
function selectedIn(ordered: QueueEntry[]): QueueEntry | null {
	const key = useQueue.getState().selected;

	return ordered.find((entry) => entry.key === key) ?? null;
}

/**
 * The queue's keyboard: j, k and the arrows select a row (and read its
 * review ahead once the selection rests), Enter opens its review, r starts a
 * missing review. The keys read the selection when pressed, and nothing here
 * follows it, so a held j re-renders only the rows it moves between. The
 * selection lives in the queue store, so it is still there after a visit to
 * a review.
 */
export function useQueueControls(ordered: QueueEntry[], sample: boolean) {
	const open = useCallback((entry: QueueEntry) => openEntry(entry, sample), [sample]);

	function move(step: number): void {
		if (ordered.length === 0) return;

		const at = ordered.findIndex((entry) => entry.key === useQueue.getState().selected);
		const next = ordered[Math.min(ordered.length - 1, Math.max(0, at === -1 ? 0 : at + step))];

		useQueue.getState().select(next.key);
		reveal(next.key);
		warmSoon(next);
	}

	function enter(): void {
		const selected = selectedIn(ordered);

		if (selected) openEntry(selected, sample);
	}

	function review(): void {
		const selected = selectedIn(ordered);

		if (selected && entryAction(selected).starts) startEntry(selected);
	}

	useKeys({
		j: () => move(1),
		ArrowDown: () => move(1),
		k: () => move(-1),
		ArrowUp: () => move(-1),
		Enter: enter,
		r: review
	});

	useEffect(
		() => () => {
			useShell.getState().setPageItems([]);
			cancelWarm();
		},
		[]
	);

	return { open, start: startEntry };
}

/**
 * The selected row, for the parts that follow it. It also lands the rows in
 * the command palette while the page is open, and the selected row's actions
 * after them, so a keyboard can reach everything the right-click menu offers.
 */
export function useQueueSelection(
	ordered: QueueEntry[],
	sample: boolean,
	onDelete: (entry: QueueEntry) => void
): QueueEntry | null {
	const selectedKey = useQueue((state) => state.selected);
	const selected = ordered.find((entry) => entry.key === selectedKey) ?? null;
	const pulls = useMemo(() => pullItems(ordered, sample), [ordered, sample]);

	useEffect(() => {
		useShell.getState().setPageItems([...pulls, ...selectedItems(selected, sample, onDelete)]);
	}, [pulls, selected, sample, onDelete]);

	return selected;
}
