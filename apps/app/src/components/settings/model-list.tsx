'use client';

import { formatContextWindow } from '@recoder/shared';
import { CommandItem } from '@recoder/ui';
import { Check } from 'lucide-react';
import type { ReactNode } from 'react';

import { FOLLOW_LABEL, rowBottom, type ModelRow } from '@/lib/settings/model-rows';
import { useMountedRows } from '@/lib/settings/use-list-view';
import type { ModelDialogView } from '@/lib/settings/use-model-dialog';

/** A row the person can choose: a model, or the row that follows the Review model. */
type ChoiceRow = Exclude<ModelRow, { kind: 'heading' }>;

/** The faint text at the row's end: the model's context window, or that its server stopped serving it. */
function rowDetail(row: ChoiceRow): string | undefined {
	if (row.kind === 'follow') return undefined;
	if (row.option.unavailable) return 'Not served';

	return row.option.contextWindow ? formatContextWindow(row.option.contextWindow) : undefined;
}

/** The row's words. A model also says its provider to a screen reader, which cannot see the heading above it. */
function rowLabel(row: ChoiceRow): ReactNode {
	if (row.kind === 'follow') return FOLLOW_LABEL;

	return (
		<>
			{row.option.name}
			<span className="sr-only">, {row.option.group}</span>
		</>
	);
}

interface ChoiceProps {
	row: ChoiceRow;
	/** This row is the pick, so it carries the check. */
	picked: boolean;
	onPick: (id: string) => void;
}

/** One choice: the check column, the name, then the context window. */
function Choice({ row, picked, onPick }: ChoiceProps) {
	return (
		<CommandItem
			value={row.key}
			onSelect={() => onPick(row.key)}
			leading={
				<span className="model-row-mark">
					{picked ? <Check aria-hidden /> : null}
					{picked ? <span className="sr-only">Current pick</span> : null}
				</span>
			}
			detail={rowDetail(row)}
			disabled={row.kind === 'model' && row.option.unavailable}
			className="model-row"
		>
			{rowLabel(row)}
		</CommandItem>
	);
}

interface ModelListProps {
	/** The dialog's search state: the laid-out rows, the scrolling list and the selected row. */
	search: Pick<ModelDialogView, 'layout' | 'list' | 'setList' | 'selected'>;
	/** The pick's row key, which carries the check. */
	current: string | null;
	onPick: (id: string) => void;
}

/**
 * The model list, windowed: only the rows near the viewport mount, with
 * spacers holding the rest of the height, so a catalog of a thousand models
 * opens and scrolls as fast as a short one.
 */
export function ModelList({ search, current, onPick }: ModelListProps) {
	const { layout, list, setList, selected } = search;
	const mounted = useMountedRows(layout, list, selected);
	const nodes: ReactNode[] = [];
	let cursor = 0;

	for (const index of mounted) {
		const row = layout.rows[index];
		const gap = layout.tops[index] - cursor;

		if (gap > 0) nodes.push(<div key={`gap-${index}`} aria-hidden style={{ height: gap }} />);

		nodes.push(
			row.kind === 'heading' ? (
				<div key={row.key} aria-hidden className="model-heading">
					{row.label}
				</div>
			) : (
				<Choice key={row.key} row={row} picked={row.key === current} onPick={onPick} />
			)
		);

		cursor = rowBottom(layout, index);
	}

	if (layout.total > cursor) nodes.push(<div key="gap-end" aria-hidden style={{ height: layout.total - cursor }} />);

	return (
		<div
			ref={(node) => {
				const scroller = node?.closest<HTMLElement>('[cmdk-list]');

				if (scroller) setList(scroller);
			}}
		>
			{nodes}
		</div>
	);
}
