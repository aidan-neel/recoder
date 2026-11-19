'use client';

import { Fragment, useMemo, type ReactNode } from 'react';

import { cn } from '../../lib/cn';
import { escapeHtml } from './highlight';
import { splitPairs } from './split-pairs';
import { useHighlighter } from './use-highlighter';

/** One line of a diff or file excerpt. */
export interface CodeLine {
	type: 'context' | 'add' | 'del';
	oldNo: number | null;
	newNo: number | null;
	text: string;
	/** Inside the range a decision points at: tinted, with an amber bar on the left. */
	flagged?: boolean;
	/** The line a link points at: tinted in the accent until another line is. */
	marked?: boolean;
}

interface CodeLinesProps {
	lines: readonly CodeLine[];
	/** A highlight language (`langForPath(path)`); plain text when null. */
	lang?: string | null;
	showOldNumbers?: boolean;
	/** Lines left out before and after the excerpt, shown as quiet "N lines above" rows. */
	gap?: { above?: number; below?: number };
	onLineClick?: (index: number) => void;
	/** Content to show under a line (a decision that ends on it), aligned with the code. */
	annotate?: (index: number) => ReactNode;
	/** Side by side, removed lines on the left and added on the right, each line's note spanning both. */
	layout?: 'unified' | 'split';
	className?: string;
}

const SIGN = { context: '', add: '+', del: '−' } as const;

const SPOKEN = { context: '', add: 'Added', del: 'Removed' } as const;

/** "1 line above", "12 lines below". */
function gapLabel(count: number, where: 'above' | 'below'): string {
	return `${count} ${count === 1 ? 'line' : 'lines'} ${where}`;
}

/** A quiet row standing for lines the excerpt leaves out. */
function Gap({ count, where }: { count: number; where: 'above' | 'below' }) {
	return (
		<div data-ui="code-lines-gap" data-where={where}>
			<span data-ui="code-lines-gap-label">{gapLabel(count, where)}</span>
		</div>
	);
}

interface RowProps {
	line: CodeLine;
	html: string;
	showOldNumbers: boolean;
	onClick?: () => void;
}

interface LineTextProps {
	type: CodeLine['type'];
	html: string;
	/** Whether a screen reader hears the change, which a split row says once, on its own side. */
	spoken: boolean;
}

/** A line's +/− sign, spoken for a change, and its highlighted text. */
function LineText({ type, html, spoken }: LineTextProps) {
	return (
		<>
			<span data-ui="code-line-sign">
				<span aria-hidden="true">{SIGN[type]}</span>
				{type !== 'context' && spoken && <span className="sr-only">{SPOKEN[type]}</span>}
			</span>
			<code data-ui="code-line-text" dangerouslySetInnerHTML={{ __html: html }} />
		</>
	);
}

/** One code line: old and new numbers, the +/− sign, and the highlighted text. */
function Row({ line, html, showOldNumbers, onClick }: RowProps) {
	return (
		<div
			data-ui="code-line"
			data-type={line.type}
			data-flagged={line.flagged || undefined}
			data-marked={line.marked || undefined}
			data-new-line={line.newNo ?? undefined}
			data-clickable={onClick ? '' : undefined}
			onClick={onClick}
		>
			{showOldNumbers && (
				<span data-ui="code-line-number" data-side="old" aria-hidden="true">
					{line.oldNo ?? ''}
				</span>
			)}
			<span data-ui="code-line-number" data-side="new" aria-hidden="true">
				{line.newNo ?? ''}
			</span>
			<LineText type={line.type} html={html} spoken />
		</div>
	);
}

interface HalfProps {
	line: CodeLine | undefined;
	html: string;
	side: 'old' | 'new';
}

/** One side of a split row: the line's number on that side, its sign and text; an empty cell where it has none. */
function Half({ line, html, side }: HalfProps) {
	if (!line) return <div data-ui="code-line" data-type="empty" data-side={side} aria-hidden="true" />;

	const ours = side === 'new' || line.type !== 'context';

	return (
		<div
			data-ui="code-line"
			data-side={side}
			data-type={line.type}
			data-flagged={(side === 'new' && line.flagged) || undefined}
			data-marked={(side === 'new' && line.marked) || undefined}
			data-new-line={side === 'new' ? (line.newNo ?? undefined) : undefined}
		>
			<span data-ui="code-line-number" aria-hidden="true">
				{(side === 'old' ? line.oldNo : line.newNo) ?? ''}
			</span>
			<LineText type={line.type} html={html} spoken={ours} />
		</div>
	);
}

/** The note under a split row: the new side's, then the old side's. */
function splitNote(annotate: CodeLinesProps['annotate'], pair: { old: number | null; new: number | null }): ReactNode {
	const notes = [pair.new, pair.old === pair.new ? null : pair.old].map((index) =>
		index === null ? null : annotate?.(index)
	);

	const shown = notes.filter((note) => note != null && note !== false);

	return shown.length > 0 ? <div data-ui="code-line-note">{shown}</div> : null;
}

/**
 * The review's code excerpt: a diff or a whole file in Geist Mono, with old
 * and new line numbers, add and remove tints, flagged lines in amber, and
 * quiet rows for the lines left out. Long lines scroll inside the block. In
 * a new file, where every line is an addition, the green tint is dropped
 * because it carries no information. Until the highlighter and the grammar
 * have loaded the lines show plain, at the same height, and the colors swap
 * in with no motion.
 */
export function CodeLines({
	lines,
	lang = null,
	showOldNumbers = true,
	gap,
	onLineClick,
	annotate,
	layout = 'unified',
	className
}: CodeLinesProps) {
	const highlighter = useHighlighter(lang);

	const html = useMemo(
		() => (highlighter ? highlighter.highlightDiff(lines, lang) : lines.map((line) => escapeHtml(line.text))),
		[highlighter, lines, lang]
	);

	const fresh = lines.length > 0 && lines.every((line) => line.type === 'add');

	const split = layout === 'split';

	const pairs = useMemo(() => (split ? splitPairs(lines) : null), [split, lines]);
	const above = gap?.above ?? 0;
	const below = gap?.below ?? 0;

	return (
		<div
			data-ui="code-lines"
			data-fresh={fresh || undefined}
			data-numbers={showOldNumbers ? 'both' : 'new'}
			data-layout={split ? 'split' : 'unified'}
			className={cn(
				'min-w-0 overflow-hidden rounded-(--radius-row) bg-code font-mono text-[12.5px] leading-[22px] text-(--syn-plain)',
				'shadow-[0_0_0_1px_var(--line-card)] [tab-size:4]',
				className
			)}
		>
			<div data-ui="code-lines-scroll" className="overflow-x-auto">
				<div data-ui="code-lines-body">
					{above > 0 && <Gap count={above} where="above" />}
					{pairs?.map((pair, row) => (
						<Fragment key={row}>
							<div data-ui="code-split-row">
								<Half
									line={pair.old === null ? undefined : lines[pair.old]}
									html={pair.old === null ? '' : html[pair.old]}
									side="old"
								/>
								<Half
									line={pair.new === null ? undefined : lines[pair.new]}
									html={pair.new === null ? '' : html[pair.new]}
									side="new"
								/>
							</div>
							{splitNote(annotate, pair)}
						</Fragment>
					))}
					{pairs
						? null
						: lines.map((line, index) => {
								const note = annotate?.(index);

								return (
									<Fragment key={index}>
										<Row
											line={line}
											html={html[index]}
											showOldNumbers={showOldNumbers}
											onClick={onLineClick && (() => onLineClick(index))}
										/>
										{note != null && note !== false && <div data-ui="code-line-note">{note}</div>}
									</Fragment>
								);
							})}
					{below > 0 && <Gap count={below} where="below" />}
				</div>
			</div>
		</div>
	);
}
