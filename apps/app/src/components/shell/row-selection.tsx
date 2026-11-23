'use client';

import { Button, Tooltip, swapMotion, toast } from '@recoder/ui';
import { CheckIcon, XIcon } from '@phosphor-icons/react';
import { AnimatePresence, motion } from 'motion/react';
import { createContext, useContext, type ReactNode } from 'react';

import { joinNames, plural } from '@/lib/shell/format';
import { undoToast } from '@/lib/shell/notify';
import { extend, pick, useRowSelection, type PickHow } from '@/lib/shell/row-selection';
import { useSettleMarks } from '@/lib/shell/settle';
import { useKeys } from '@/lib/shell/use-keys';

import type { RowPick } from './recent-row';

/** A row of Reviews or Chats that can be picked, in the order the sidebar lists it. */
export interface PickableRow {
	id: string;
	title: string;
	kind: 'review' | 'chat';
	/** A review still running: settled, it would come back the moment its result lands, so a bulk settle leaves it. */
	busy: boolean;
}

interface SelectionView {
	selected: readonly string[];
	click: (id: string, how: PickHow) => void;
	step: (id: string, step: 1 | -1) => void;
	clear: () => void;
	settleSelected: () => void;
}

const SelectionContext = createContext<SelectionView | null>(null);

/** "Settled 3 reviews and 1 chat". */
function settledTitle(rows: PickableRow[]): string {
	const reviews = rows.filter((row) => row.kind === 'review').length;
	const chats = rows.length - reviews;
	const parts = [reviews ? plural(reviews, 'review') : '', chats ? plural(chats, 'chat') : ''];

	return `Settled ${joinNames(parts.filter(Boolean))}`;
}

/** Names the rows a bulk settle left where they were; none when it left none. */
function skippedNote(rows: PickableRow[]): string | undefined {
	if (rows.length === 0) return undefined;

	return `Skipped ${plural(rows.length, 'running review')}: ${joinNames(rows.map((row) => row.title))}`;
}

/** The row that takes focus once `gone` leave the list: the first after them that stays, else the last before. */
function survivor(order: readonly string[], gone: readonly string[]): string | undefined {
	const first = order.findIndex((id) => gone.includes(id));
	const stays = (id: string) => !gone.includes(id);

	return order.slice(first).find(stays) ?? [...order.slice(0, first)].reverse().find(stays);
}

/** True while keyboard focus sits on the selection bar or on one of the rows with `ids`, which are about to go. */
function focusLeaves(ids: readonly string[]): boolean {
	const focused = document.activeElement;
	const row = focused?.closest<HTMLElement>('[data-row-id]')?.dataset.rowId;

	return !!focused?.closest('.selection-bar') || (row !== undefined && ids.includes(row));
}

/** Focuses the link of the row with `id`. */
function focusRow(id: string): void {
	document.querySelector<HTMLElement>(`[data-row-id="${CSS.escape(id)}"] a`)?.focus();
}

/**
 * Multi-select for the sidebar's Reviews and Chats, as a Mac list does it: Shift-click selects from the row last
 * opened or Cmd/Ctrl-clicked, Cmd/Ctrl-click adds or drops one row, Shift+arrows grow the range from the focused row,
 * and a plain click opens a row and empties the selection. With rows selected a bar over the sidebar's foot settles
 * them all (`e`), with Undo, and Escape empties it. `rows` are the rows on screen, in order.
 */
export function RowSelectionScope({ rows, children }: { rows: PickableRow[]; children: ReactNode }) {
	const selection = useRowSelection();
	const settle = useSettleMarks((state) => state.settle);
	const order = rows.map((row) => row.id);
	const selected = order.filter((id) => selection.ids.includes(id));

	function settleSelected(): void {
		const chosen = rows.filter((row) => selected.includes(row.id));
		const ready = chosen.filter((row) => !row.busy);
		const skipped = chosen.filter((row) => row.busy);

		selection.clear();

		if (ready.length === 0) {
			toast('Nothing to settle', { description: skippedNote(skipped) });

			return;
		}

		const ids = ready.map((row) => row.id);
		const next = focusLeaves(ids) ? survivor(order, ids) : undefined;

		undoToast(settledTitle(ready), settle(ids), skippedNote(skipped));

		if (next) focusRow(next);
	}

	const view: SelectionView = {
		selected,
		click: (id, how) => selection.set(pick(selection, order, id, how)),
		step(id, step) {
			const next = extend({ ...selection, ids: selected }, order, id, step);

			if (!next) return;

			selection.set(next.selection);
			focusRow(next.focus);
		},
		clear: selection.clear,
		settleSelected
	};

	useKeys(selected.length > 0 ? { Escape: selection.clear, e: settleSelected } : {});

	return (
		<SelectionContext.Provider value={view}>
			{children}
			<SelectionBar count={selected.length} onSettle={settleSelected} onClear={selection.clear} />
		</SelectionContext.Provider>
	);
}

interface SelectionBarProps {
	count: number;
	onSettle: () => void;
	onClear: () => void;
}

/** The bulk action: how many rows are selected, a way to let them go, and Settle. It stands in for the sidebar's foot. */
function SelectionBar({ count, onSettle, onClear }: SelectionBarProps) {
	return (
		<AnimatePresence>
			{count > 0 ? (
				<motion.div
					key="bar"
					className="selection-bar"
					role="toolbar"
					aria-label="Selected rows"
					variants={swapMotion}
					initial="initial"
					animate="animate"
					exit="exit"
				>
					<span className="selection-count" aria-live="polite">
						{count} selected
					</span>
					<Tooltip content="Clear selection" shortcut="Escape">
						<Button variant="ghost" size="icon" aria-label="Clear selection" onClick={onClear}>
							<XIcon />
						</Button>
					</Tooltip>
					<Tooltip content={`Settle ${plural(count, 'row')}`} shortcut="e">
						<Button variant="primary" aria-keyshortcuts="E" onClick={onSettle}>
							<CheckIcon />
							Settle
						</Button>
					</Tooltip>
				</motion.div>
			) : null}
		</AnimatePresence>
	);
}

/**
 * The picking props for one row of Reviews or Chats: whether it is selected, and a Settle that takes the whole
 * selection when the row is part of it (so its ✓ and its menu read "Settle 4").
 */
export function usePickableRow(): (
	id: string,
	settleOne: () => void
) => {
	selected: boolean;
	settleCount: number;
	onSettle: () => void;
	pick: RowPick;
} {
	const view = useContext(SelectionContext);

	if (!view) throw new Error('A pickable row must be inside a RowSelectionScope.');

	return (id, settleOne) => {
		const selected = view.selected.includes(id);

		return {
			selected,
			settleCount: selected ? view.selected.length : 1,
			onSettle: selected ? view.settleSelected : settleOne,
			pick: {
				id,
				onPick: (how) => view.click(id, how),
				onStep: (step) => view.step(id, step),
				onClear: view.clear
			}
		};
	};
}
