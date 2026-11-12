'use client';

import { cn, Skeleton, SkeletonRows } from '@recoder/ui';
import type { CSSProperties, ReactNode } from 'react';

import { countVars, MAX_ROWS, useRowCount, type CountKey } from '@/lib/settings/last-counts';

/** A settings row's height: two lines and a control in `.settings-row`, hairline included. */
const ROW_HEIGHT = 58;

/** Name and description widths, cycled, so the placeholder rows don't read as copies. */
const WIDTHS = [
	['24%', '46%'],
	['30%', '38%'],
	['20%', '42%'],
	['28%', '34%'],
	['22%', '40%']
] as const;

/** How a row of the group looks, shared by every way of counting its rows. */
export interface RowShape {
	/** Each row's exact height in px: {@link ROW_HEIGHT} unless the group's rows are shorter. */
	height?: number;
	/** A round glyph leading each row, for rows that start with a status glyph. */
	glyph?: boolean;
	/** Bars per row: two for a name over a description, one for a name alone. */
	lines?: 1 | 2;
	/** For rows whose words are known before they load: each row's, which size it ({@link CopyRow}). */
	copy?: readonly RowCopy[];
}

/** The words of a row known before it loads, and its control, which a placeholder row is drawn to, hidden. */
export interface RowCopy {
	name: string;
	description: string;
	/**
	 * The row's control, for its size. A control whose size depends on what
	 * loads (a model picker) is a box of a likely size instead.
	 */
	control?: ReactNode;
	/** A labelled number field: the label wraps, and the number stays beside it at every width (`.settings-limit`). */
	field?: boolean;
}

/** What a remembered list that was empty shows in its group: none of it, or one row, its empty state. */
export type EmptyRows = 'hide' | 'row';

/** A command placeholder's height: the hint, the one-line code block under it and the space below, as in `.provider-command`. */
const COMMAND_HEIGHT = 70;

/** A command placeholder's bars: the hint over the code block, which runs the full width. */
const COMMAND_WIDTHS = [['34%', '100%']] as const;

/**
 * A placeholder row drawn to the words and control of the row it stands for,
 * all hidden, so it is as tall as that row at any width: the words wrap and
 * the control drops under them where the loaded row's do. Its bars sit over
 * the name and the first line under it, as in the other placeholder rows.
 */
function CopyRow({ row, widths }: { row: RowCopy; widths: readonly [string, string] }) {
	return (
		<div className={cn('settings-copy-row', row.field && 'settings-copy-field')}>
			<div className="settings-copy-words">
				<p className="settings-copy-name">{row.name}</p>
				<p className="settings-copy-desc">{row.description}</p>
				<div data-ui="skeleton-row-bars" className="settings-copy-bars">
					<Skeleton style={{ width: widths[0] }} />
					<Skeleton style={{ width: widths[1] }} />
				</div>
			</div>
			{row.field ? <span className="settings-copy-number" /> : null}
			{row.control ? <div className="settings-copy-control">{row.control}</div> : null}
		</div>
	);
}

/**
 * The placeholder rows themselves, invisible for the kit's skeleton delay.
 * In the server's HTML, a remembered list draws the most rows a list can
 * have, cut to its stored length by CSS (`.settings-rows-clip`).
 */
export function Rows({
	count,
	height = ROW_HEIGHT,
	glyph,
	lines = 2,
	copy,
	clip
}: RowShape & { count: number | null; clip?: boolean }) {
	const className = clip ? 'settings-rows-clip' : undefined;

	if (copy) {
		return (
			<div aria-hidden className={cn('settings-copy-rows', className)}>
				{copy.slice(0, count ?? copy.length).map((row, index) => (
					<CopyRow key={row.name} row={row} widths={WIDTHS[index % WIDTHS.length]} />
				))}
			</div>
		);
	}

	return (
		<SkeletonRows
			count={count ?? MAX_ROWS}
			height={height}
			glyph={glyph}
			lines={lines}
			widths={WIDTHS}
			className={className}
			rowClassName={lines === 2 ? 'settings-skeleton-row settings-skeleton-tall' : 'settings-skeleton-row'}
		/>
	);
}

/**
 * The commands under a group's rows, as many as at the last load, each as
 * tall as the real one. They follow the rows instead of sitting under the
 * CLI that needs one, which a skeleton can't know, so the card is as tall as
 * the one that replaces it. Before React runs, the most a list holds are
 * drawn and cut to the remembered count by CSS (`.settings-commands-clip`).
 */
export function Commands({ list }: { list: CountKey }) {
	const count = useRowCount(list);

	if (count === 0) return null;

	const server = count === null;
	const vars = countVars(list);

	return (
		<div
			className={server ? 'settings-skeleton-part settings-commands-clip' : 'settings-skeleton-part'}
			style={server ? ({ '--rows': `var(${vars.rows}, ${vars.fallback})` } as CSSProperties) : undefined}
		>
			<SkeletonRows
				count={count ?? MAX_ROWS}
				height={COMMAND_HEIGHT}
				widths={COMMAND_WIDTHS}
				rowClassName="settings-skeleton-command"
			/>
		</div>
	);
}

/**
 * A remembered list's rows, or its empty row when it had none. In the
 * server's HTML, and the render that hydrates it, storage can't be read: the
 * script ahead of the section copies the list's length onto `<html>`, and the
 * rows are cut to it, or swapped for the empty row, through those variables.
 * Once hydrated it draws that many rows itself.
 */
export function CountedRows({
	list,
	count,
	empty,
	...shape
}: RowShape & { empty?: EmptyRows; list: CountKey; count: number | null }) {
	const vars = countVars(list);

	if (count === 0 && empty === 'row') {
		return (
			<div className="settings-skeleton-part">
				<Rows count={1} />
			</div>
		);
	}

	if (count !== null) {
		return (
			<div className="settings-skeleton-part">
				<Rows count={count} {...shape} />
			</div>
		);
	}

	return (
		<>
			<div
				className="settings-skeleton-part"
				style={
					{
						'--rows': `var(${vars.rows}, ${vars.fallback})`,
						...(empty === 'row' ? { display: `var(${vars.ifRows}, flex)` } : {})
					} as CSSProperties
				}
			>
				<Rows count={null} clip {...shape} />
			</div>
			{empty === 'row' ? (
				<div className="settings-skeleton-part" style={{ display: `var(${vars.ifEmpty}, none)` }}>
					<Rows count={1} />
				</div>
			) : null}
		</>
	);
}
