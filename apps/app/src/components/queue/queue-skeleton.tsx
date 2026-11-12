'use client';

import { ScrollArea, Skeleton, SkeletonRows, SkeletonText } from '@recoder/ui';
import { cn } from '@recoder/ui/cn';
import { memo, type CSSProperties } from 'react';

import { MAX_BRIEF, MAX_NOTES, MAX_ROWS, SHAPE_SCRIPT, useSkeletonShape } from '@/lib/queue/queue-snapshot';
import { handOffOnLeave } from '@/lib/shell/skeleton-handoff';

/** The headline's line height: 27px type on a 1.38 line, as `.brief` sets it. */
const BRIEF_LINE = 27 * 1.38;

/**
 * The headline bars' widths, by line and not by count, so the server's frame
 * (which draws the most lines, cut to the kept count) and the hydrated
 * skeleton draw the same bars.
 */
const BRIEF_WIDTHS = ['62%', '46%', '30%'];

/** A section head's text line: 12.5px type on a 1.4 line, as `.queue-head` sets it. */
const HEAD_LINE = 12.5 * 1.4;

/** A row, in CSS px: 14px padding twice, a 22px title line, the 5px gap, a 17px meta line and the 1px line. Narrow rows are taller (queue.css). */
export const ROW_HEIGHT = 73;

/** The old app's placeholder rows: a title line and a meta line half as long plus a bit. */
const ROW_WIDTHS = [
	['52%', '36%'],
	['38%', '29%'],
	['46%', '33%'],
	['30%', '25%'],
	['42%', '31%']
] as const;

interface QueueSkeletonProps {
	/** Rows to show: as many as the list last had. Undefined before storage can be read (see `useSkeletonShape`). */
	rows: number | undefined;
	/** Note lines to keep room for under the headline: as many as the last list had. Undefined before storage can be read. */
	notes: number | undefined;
	/** The headline's lines the last list took at this window width; undefined leaves them to CSS. */
	brief: number | undefined;
	/** How tall the last list's notes were in this width's band, as a CSS length; undefined sizes them by their count. */
	notesHeight: string | undefined;
}

interface NoteLinesProps {
	count: number;
	className?: string;
	/** The notes' height when known, which a note whose text wraps makes taller than its line. */
	height?: string;
}

/** Placeholders for the note lines under the headline, each as tall as the note it stands for. */
function NoteLines({ count, className, height }: NoteLinesProps) {
	return (
		<div className={cn('queue-notes', className)}>
			<div className="queue-notes-list" style={height === undefined ? undefined : { height }}>
				{Array.from({ length: count }, (_, index) => (
					<div key={index} className="queue-skeleton-note">
						<Skeleton className="h-2.5 w-[46%]" />
					</div>
				))}
			</div>
		</div>
	);
}

/**
 * The headline's bars: the most lines a headline takes, cut by CSS to the
 * lines the last list's took at this window width, else to one (two below
 * 451px, where the usual sentence wraps).
 */
function BriefLines({ lines }: { lines: number | undefined }) {
	return (
		<div className="queue-brief">
			<div
				className="queue-skeleton-brief"
				style={lines === undefined ? undefined : ({ '--queue-skeleton-brief': lines } as CSSProperties)}
			>
				<SkeletonText count={MAX_BRIEF} lineHeight={BRIEF_LINE} barHeight={27} widths={BRIEF_WIDTHS} />
			</div>
		</div>
	);
}

/**
 * The queue while it loads: the headline, any note lines the last list had,
 * the first section's head and its rows, each exactly as tall as what
 * replaces it, so the swap moves nothing. Bars and dividers stay invisible
 * for the kit's skeleton delay, so a fast load never flashes them. It holds
 * no state, so the boot frame's server render paints it: there, with no
 * storage to read, it draws the most rows and note lines a list leaves, and
 * its shape script cuts them to the last list's before first paint. The
 * headline's lines follow what the last list measured on screen at this
 * window width, and the notes' height what it measured on this side of 450px.
 * When it leaves with its bars showing, a
 * skeleton that replaces it (first run's, once the setup check says it is
 * needed) shows at once (`handOffOnLeave`).
 */
export const QueueSkeleton = memo(function QueueSkeleton({ rows, notes, brief, notesHeight }: QueueSkeletonProps) {
	const server = rows === undefined || notes === undefined;

	return (
		<div
			ref={handOffOnLeave}
			data-ui="skeleton-hold"
			className="queue-skeleton"
			aria-busy="true"
			aria-label="Loading pull requests"
		>
			{server ? <script dangerouslySetInnerHTML={{ __html: SHAPE_SCRIPT }} /> : null}
			<BriefLines lines={brief} />
			{server ? (
				<NoteLines count={MAX_NOTES} className="queue-skeleton-notes" />
			) : notes > 0 ? (
				<NoteLines count={notes} height={notesHeight} />
			) : null}
			<div className="queue-head" data-first>
				<SkeletonText count={1} lineHeight={HEAD_LINE} barHeight={10} widths={['4.5rem']} />
			</div>
			<SkeletonRows
				count={rows ?? MAX_ROWS}
				height={ROW_HEIGHT}
				glyph
				widths={ROW_WIDTHS}
				className={server ? 'queue-skeleton-rows' : undefined}
				rowClassName="queue-row"
			/>
		</div>
	);
});

/**
 * The queue while it loads, in the page's scroll area and column, shaped
 * like the last list (see `useSkeletonShape`): what the queue keeps for the
 * task after the app takes over a full load.
 */
export function QueueLoading() {
	const shape = useSkeletonShape();

	return (
		<ScrollArea className="min-h-0 flex-1">
			<div className="queue-column">
				<QueueSkeleton {...shape} />
			</div>
		</ScrollArea>
	);
}
