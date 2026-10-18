'use client';

import { Fragment, useMemo, type ReactNode } from 'react';

import { cn } from '../../lib/cn';
import { highlightDiff } from './highlight-lines';

/** One line of a diff or file excerpt. */
export interface CodeLine {
	type: 'context' | 'add' | 'del';
	oldNo: number | null;
	newNo: number | null;
	text: string;
	/** Inside the range a decision points at: tinted, with an amber bar on the left. */
	flagged?: boolean;
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

/** One code line: old and new numbers, the +/− sign, and the highlighted text. */
function Row({ line, html, showOldNumbers, onClick }: RowProps) {
	return (
		<div
			data-ui="code-line"
			data-type={line.type}
			data-flagged={line.flagged || undefined}
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
			<span data-ui="code-line-sign">
				<span aria-hidden="true">{SIGN[line.type]}</span>
				{line.type !== 'context' && <span className="sr-only">{SPOKEN[line.type]}</span>}
			</span>
			<code data-ui="code-line-text" dangerouslySetInnerHTML={{ __html: html }} />
		</div>
	);
}

/**
 * The review's code excerpt: a diff or a whole file in Geist Mono, with old
 * and new line numbers, add and remove tints, flagged lines in amber, and
 * quiet rows for the lines left out. Long lines scroll inside the block. In
 * a new file, where every line is an addition, the green tint is dropped
 * because it carries no information.
 */
export function CodeLines({
	lines,
	lang = null,
	showOldNumbers = true,
	gap,
	onLineClick,
	annotate,
	className
}: CodeLinesProps) {
	const html = useMemo(() => highlightDiff(lines, lang), [lines, lang]);
	const fresh = lines.length > 0 && lines.every((line) => line.type === 'add');
	const above = gap?.above ?? 0;
	const below = gap?.below ?? 0;

	return (
		<div
			data-ui="code-lines"
			data-fresh={fresh || undefined}
			data-numbers={showOldNumbers ? 'both' : 'new'}
			className={cn(
				'min-w-0 overflow-hidden rounded-[10px] bg-code font-mono text-[12.5px] leading-[22px] text-(--syn-plain)',
				'shadow-[0_0_0_1px_var(--line-card)] [tab-size:4]',
				className
			)}
		>
			<div data-ui="code-lines-scroll" className="thin-scroll overflow-x-auto">
				<div data-ui="code-lines-body">
					{above > 0 && <Gap count={above} where="above" />}
					{lines.map((line, index) => {
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
