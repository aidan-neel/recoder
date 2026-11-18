'use client';

import type { CSSProperties, ReactNode } from 'react';
import type { RevealSpec } from 'skullet';
import { Skeleton as SkulletSkeleton, SkeletonBox as SkulletBox, SkulletProvider } from 'skullet/react';

import { cn } from '../../lib/cn';
import { rem } from '../../lib/rem';
import { DURATION } from '../../motion/presets';

/**
 * Drops every skeleton shape this browser remembered. The shapes keep layout
 * and no content, but an app still clears them when a person signs out.
 */
export { forgetShapes as forgetSkeletonShapes } from 'skullet';

interface SkeletonProps {
	/** Shows the skeleton in place of the content. */
	loading: boolean;
	/** Remembers the content's shape under this key, so the next load draws its skeleton from it. */
	id?: string;
	className?: string;
	style?: CSSProperties;
	/** The content; while loading, a stand-in for it built from the same components. */
	children: ReactNode;
}

/**
 * Hands content to Skullet through a prop. Skullet re-creates every element
 * it finds in `children` while a skeleton loads, which turns a lone string
 * child into a list and breaks a component that takes its text as its
 * child, such as `Markdown`. Content in a prop is left as written.
 */
function Held({ content }: { content: ReactNode }) {
	return content;
}

/**
 * Loading states are Skullet's. `Skeleton` wraps what will render once the
 * data is in. While it loads, its children are a stand-in built from the
 * same components (or the shape the content had on the last visit, under
 * its `id`), laid out unseen, and a bar is drawn over every line, picture
 * and control. The skeleton takes the room the content will, so nothing
 * moves when it lands.
 */
export function Skeleton({ children, ...props }: SkeletonProps) {
	return (
		<SkulletSkeleton {...props}>
			<Held content={children} />
		</SkulletSkeleton>
	);
}

interface SkeletonBoxProps {
	className?: string;
	style?: CSSProperties;
}

/**
 * One bar, for a lone value with nothing to measure. It is sized like any
 * element, by `className` or `style`: 12px tall and as wide as its box unless
 * told otherwise. Skullet's own inline size is left empty so a class can set it.
 */
export function SkeletonBox({ className, style }: SkeletonBoxProps) {
	return <SkulletBox width="" height="" radius="" className={className} style={style} />;
}

/** How long a skeleton stays unseen, in ms, so data that lands sooner never flashes one. */
const HOLD_MS = 120;

/**
 * How content takes its skeleton's place: whole, in one short crossfade,
 * with no rise and no stagger. A load that beat the hold, or one that lands
 * while someone scrolls or types, swaps with no fade at all.
 */
const REVEAL: RevealSpec = {
	hold: HOLD_MS,
	choose: ({ waited, input }) =>
		input || waited < HOLD_MS ? { duration: 0 } : { order: 'together', duration: DURATION.swap * 1000 }
};

/** Gives every skeleton below it the kit's reveal. An app mounts one at its root. */
export function SkeletonProvider({ children }: { children: ReactNode }) {
	return <SkulletProvider reveal={REVEAL}>{children}</SkulletProvider>;
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
 * Lines of text still loading, where the text itself cannot be laid out to
 * measure: one bar per line, each centred in a line box of exactly
 * `lineHeight`, so the text that replaces it takes the same height.
 */
export function SkeletonText({ count, widths, lineHeight = 20, barHeight, className }: SkeletonTextProps) {
	const total = count ?? widths?.length ?? 3;
	const line = rem(lineHeight);
	const bar = rem(barHeight ?? Math.round(lineHeight * 0.55));

	return (
		<div data-ui="skeleton-text" aria-hidden className={className}>
			{Array.from({ length: total }, (_, index) => (
				<div key={index} data-ui="skeleton-line" style={{ height: line }}>
					<SkeletonBox
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
 * A list still loading, where its rows cannot be laid out to measure: rows of
 * an exact height with an optional leading glyph and one or two bars, so the
 * list that replaces it lands on the same lines.
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
		<div data-ui="skeleton-rows" aria-hidden className={className}>
			{Array.from({ length: count }, (_, index) => {
				const [title, meta] = widths[index % widths.length];

				return (
					<div key={index} data-ui="skeleton-row" className={cn(rowClassName)} style={{ height: rowHeight }}>
						{glyph ? <SkeletonBox className="size-4 shrink-0 rounded-full" /> : null}
						<div data-ui="skeleton-row-bars">
							<SkeletonBox style={{ width: title }} />
							{lines === 2 ? <SkeletonBox style={{ width: meta }} /> : null}
						</div>
					</div>
				);
			})}
		</div>
	);
}
