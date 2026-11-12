import type { CSSProperties } from 'react';

import { cn } from '../../lib/cn';
import { rem } from '../../lib/rem';

interface SkeletonProps {
	className?: string;
	style?: CSSProperties;
}

/**
 * A shimmering placeholder bar, 12px tall with 5px corners unless a class
 * says otherwise. It stays invisible for `--skeleton-delay`, so data that
 * arrives fast never flashes a skeleton, then fades in over `--dur-swap`,
 * slow at first, so one the content replaces a few frames later stays faint.
 * Content then swaps in place with no entrance animation. The shimmer stops
 * after about 10s and the bar rests.
 */
export function Skeleton({ className, style }: SkeletonProps) {
	return <div data-ui="skeleton" aria-hidden className={cn(className)} style={style} />;
}

interface SkeletonTextProps {
	/** How many lines. Defaults to the number of `widths`, or 3. */
	count?: number;
	/**
	 * Each line's width as a CSS length, cycled. Percentages follow the
	 * column. Without it, lines run full and the last one ends short, like a
	 * paragraph.
	 */
	widths?: readonly string[];
	/** The line height of the text this stands for, in px, so the block is exactly as tall as that text. */
	lineHeight?: number;
	/** Each bar's height in px; a little over half the line height by default. */
	barHeight?: number;
	className?: string;
}

/** The width of a default line: full, a touch shorter, and a short last line. */
function paragraphWidth(index: number, count: number): string {
	if (index === count - 1 && count > 1) return '62%';

	return index % 2 === 0 ? '100%' : '94%';
}

/**
 * Lines of text still loading: one bar per line, each centred in a line box
 * of exactly `lineHeight`, so the text that replaces it takes the same height
 * and nothing below moves.
 */
export function SkeletonText({ count, widths, lineHeight = 20, barHeight, className }: SkeletonTextProps) {
	const total = count ?? widths?.length ?? 3;
	const line = rem(lineHeight);
	const bar = rem(barHeight ?? Math.round(lineHeight * 0.55));

	return (
		<div data-ui="skeleton-text" aria-hidden className={cn(className)}>
			{Array.from({ length: total }, (_, index) => (
				<div key={index} data-ui="skeleton-line" style={{ height: line }}>
					<Skeleton
						style={{ width: widths ? widths[index % widths.length] : paragraphWidth(index, total), height: bar }}
					/>
				</div>
			))}
		</div>
	);
}

/** The title and meta widths rows cycle through, so a list reads as rows of different lengths. */
const ROW_WIDTHS: readonly (readonly [string, string])[] = [
	['68%', '36%'],
	['54%', '28%'],
	['76%', '42%'],
	['60%', '32%'],
	['72%', '24%']
];

interface SkeletonRowsProps {
	/** How many rows. */
	count?: number;
	/** Each row's exact height in px, matching the rows that replace it. */
	height: number;
	/** A 16px round glyph leading each row, where a status glyph will sit. */
	glyph?: boolean;
	/** A title bar over a meta bar (2, the default), or the title alone (1). */
	lines?: 1 | 2;
	/** The title and meta bar widths for each row, cycled. */
	widths?: readonly (readonly [string, string])[];
	/** On each row, to give it the real row's padding, gap and divider. */
	rowClassName?: string;
	className?: string;
}

/**
 * A list still loading: rows of an exact height with an optional leading
 * glyph and one or two text bars, so the list that replaces it lands on the
 * same lines.
 */
export function SkeletonRows({
	count = 3,
	height,
	glyph = false,
	lines = 2,
	widths = ROW_WIDTHS,
	rowClassName,
	className
}: SkeletonRowsProps) {
	const rowHeight = rem(height);

	return (
		<div data-ui="skeleton-rows" aria-hidden className={cn(className)}>
			{Array.from({ length: count }, (_, index) => {
				const [title, meta] = widths[index % widths.length];

				return (
					<div key={index} data-ui="skeleton-row" className={cn(rowClassName)} style={{ height: rowHeight }}>
						{glyph ? <Skeleton className="size-4 shrink-0 rounded-full" /> : null}
						<div data-ui="skeleton-row-bars">
							<Skeleton style={{ width: title }} />
							{lines === 2 ? <Skeleton style={{ width: meta }} /> : null}
						</div>
					</div>
				);
			})}
		</div>
	);
}
