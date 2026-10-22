'use client';

import { toast } from '@recoder/ui';
import { GitPullRequest } from 'lucide-react';
import { useCallback, useEffect } from 'react';

import { entryAction, entryHref, type QueueEntry } from '@/lib/queue/queue';
import { useQueue } from '@/lib/queue/queue-store';
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

/**
 * Scrolls a row into view without jumping when it already shows. While focus
 * is in another row (Tab, or a clicked button), it moves to this row's title,
 * so the focus ring and the selection never part, as in the review rail.
 */
function reveal(key: string): void {
	const row = document.querySelector<HTMLElement>(`[data-queue-key="${CSS.escape(key)}"]`);
	const focused = document.activeElement;

	if (row && focused instanceof HTMLElement && focused.closest('[data-queue-row]') && !row.contains(focused)) {
		row.querySelector<HTMLElement>('[data-ui="row-button"]')?.focus({ preventScroll: true });
	}

	row?.scrollIntoView({ block: 'nearest' });
}

/**
 * Opens the row's review. A row without one is only selected: a review costs
 * money, so it starts from the row's own button or r, never from Enter or a
 * click on the row. In the sample, it says which review opens.
 */
function openEntry(entry: QueueEntry, sample: boolean): void {
	const href = entryHref(entry, sample);

	if (href) return useShell.getState().navigate(href);

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

/**
 * The queue's keyboard and palette: j, k and the arrows select a row, Enter
 * opens its review, r starts a missing review. The rows also land in the command
 * palette while the page is open, and the selected row's actions after them.
 * The selection lives in the queue store, so it is still there after a visit
 * to a review.
 */
export function useQueueControls(ordered: QueueEntry[], sample: boolean, onDelete: (entry: QueueEntry) => void) {
	const selectedKey = useQueue((state) => state.selected);
	const selected = ordered.find((entry) => entry.key === selectedKey) ?? null;
	const open = useCallback((entry: QueueEntry) => openEntry(entry, sample), [sample]);

	function move(step: number): void {
		if (ordered.length === 0) return;

		const at = ordered.findIndex((entry) => entry.key === selectedKey);
		const next = ordered[Math.min(ordered.length - 1, Math.max(0, at === -1 ? 0 : at + step))];

		useQueue.getState().select(next.key);
		reveal(next.key);
	}

	useKeys({
		j: () => move(1),
		ArrowDown: () => move(1),
		k: () => move(-1),
		ArrowUp: () => move(-1),
		Enter: () => selected && openEntry(selected, sample),
		r: () => selected && entryAction(selected).starts && startEntry(selected)
	});

	useEffect(() => {
		useShell.getState().setPageItems([...pullItems(ordered, sample), ...selectedItems(selected, sample, onDelete)]);
	}, [ordered, sample, selected, onDelete]);

	useEffect(() => () => useShell.getState().setPageItems([]), []);

	return { selected, open, start: startEntry };
}
