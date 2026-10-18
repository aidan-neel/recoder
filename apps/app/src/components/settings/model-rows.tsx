'use client';

import { formatContextWindow } from '@recoder/shared';
import { CommandItem } from '@recoder/ui';
import { Check } from 'lucide-react';
import { useCallback, useSyncExternalStore, type ReactNode } from 'react';

import {
	FOLLOW_ID,
	FOLLOW_LABEL,
	mountedRows,
	rowBottom,
	type ModelRow,
	type RowLayout
} from '@/lib/settings/model-rows';

/** Rows mounted beyond each edge of the viewport, so a short scroll never shows a gap. */
const OVERSCAN = 240;

/** The check column's blank, for rows that are not the current pick. */
function NoMark() {
	return <span className="block size-[15px]" />;
}

/**
 * The list's scroll position below its top padding `pad`, and its height,
 * read from the element itself. A scroll, a resize, or a `scroll` event
 * dispatched after a programmatic scroll re-renders the rows in the same frame.
 */
function useListView(list: HTMLElement | null, pad: number): { top: number; height: number } {
	const subscribe = useCallback(
		(notify: () => void) => {
			if (!list) return () => {};

			const observer = new ResizeObserver(notify);

			observer.observe(list);
			list.addEventListener('scroll', notify, { passive: true });

			return () => {
				observer.disconnect();
				list.removeEventListener('scroll', notify);
			};
		},
		[list]
	);

	const top = useSyncExternalStore(subscribe, () => (list ? list.scrollTop : 0));
	const height = useSyncExternalStore(subscribe, () => (list ? list.clientHeight : 0));

	return { top: Math.max(0, top - pad), height };
}

interface ModelRowsProps {
	layout: RowLayout;
	/** The scrolling list; null until the first commit finds it. */
	list: HTMLElement | null;
	onList: (list: HTMLElement) => void;
	/** The selected row's key: it stays mounted however far the list scrolls from it. */
	selected: string | null;
	/** The saved pick, which carries the check. */
	current: string | null;
	onPick: (id: string) => void;
}

/**
 * The model list, windowed: only the rows near the viewport mount, with
 * spacers holding the rest of the height, so a catalog of a thousand models
 * opens and scrolls as fast as a short one. Until the list is measured only
 * the selected row mounts, so the palette lands on it first.
 */
export function ModelRows({ layout, list, onList, selected, current, onPick }: ModelRowsProps) {
	const view = useListView(list, layout.pad);
	const pinned = selected === null ? [] : [layout.index.get(selected) ?? -1];
	const indexes = list ? mountedRows(layout, view.top, view.height, OVERSCAN, pinned) : pinned.filter((at) => at >= 0);

	/** One row: a provider heading, the follow row, or a model with its context window. */
	function renderRow(row: ModelRow): ReactNode {
		if (row.kind === 'heading') {
			return (
				<div key={row.key} aria-hidden className="model-heading">
					{row.label}
				</div>
			);
		}

		const id = row.kind === 'follow' ? FOLLOW_ID : row.option.id;
		const tokens = row.kind === 'model' ? row.option.contextWindow : null;

		return (
			<CommandItem
				key={row.key}
				value={id}
				onSelect={() => onPick(id)}
				icon={id === current ? Check : NoMark}
				detail={tokens ? formatContextWindow(tokens) : undefined}
				className="model-row"
			>
				{row.kind === 'follow' ? FOLLOW_LABEL : row.option.name}
			</CommandItem>
		);
	}

	const nodes: ReactNode[] = [];
	let cursor = 0;

	for (const index of indexes) {
		const gap = layout.tops[index] - cursor;

		if (gap > 0) nodes.push(<div key={`gap-${index}`} aria-hidden style={{ height: gap }} />);

		nodes.push(renderRow(layout.rows[index]));
		cursor = rowBottom(layout, index);
	}

	if (layout.total > cursor) nodes.push(<div key="gap-end" aria-hidden style={{ height: layout.total - cursor }} />);

	return (
		<div
			data-ui="model-rows"
			ref={(node) => {
				const scroller = node?.closest<HTMLElement>('[cmdk-list]');

				if (scroller) onList(scroller);
			}}
		>
			{nodes}
		</div>
	);
}
