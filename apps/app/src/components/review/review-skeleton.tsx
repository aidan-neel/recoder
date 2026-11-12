'use client';

import { Skeleton, SkeletonRows, SkeletonText } from '@recoder/ui/skeleton';
import { useState, useSyncExternalStore, type CSSProperties, type ReactNode } from 'react';

import { PanelHeader } from '@/components/common/panel-header';
import {
	guessRows,
	MOST,
	RAIL_MIN_VAR,
	SHAPE_SCRIPT,
	SHAPE_VARS,
	shapeFor,
	type Shape
} from '@/lib/review/review-shapes';

/** A decision row's height: a two-line title (13px on 1.38) over its mono location, plus the row's padding. */
export const DECISION_ROW = 68.4;

/** A file row's height: a 17.25px line of 11.5px mono with 5px of padding each side (`.rail-file`). */
const FILE_ROW = 27.25;

/** A rail group heading's line: 12px text on an 18px line. */
const HEADING_LINE = 18;

/** Title and location widths, so the rows read as findings of different lengths. */
const DECISION_WIDTHS = [
	['84%', '34%'],
	['72%', '42%'],
	['90%', '30%'],
	['66%', '38%'],
	['78%', '28%'],
	['70%', '36%'],
	['86%', '32%']
] as const;

/** Path widths, so the file rows read as paths of different lengths. */
const FILE_WIDTHS = [
	['76%', ''],
	['62%', ''],
	['84%', ''],
	['70%', ''],
	['56%', '']
] as const;

/** The overview's summary: 20px serif on a 1.5 line height. */
const INTENT_LINE = 30;

/**
 * The summary's line widths, by line and not by count, so the server's frame
 * (which draws the most lines, cut to the kept count) and the hydrated
 * skeleton draw the same bars.
 */
const SUMMARY_WIDTHS = ['100%', '94%', '82%'];

/** The "N of M changed lines" lead: 15px on 1.45. */
const LEAD_LINE = 21.75;

/**
 * The lead's two lines: the first as long as a one-line lead, or nearly the
 * column where the lead wraps (review-overview.css), which keeps the second.
 */
const LEAD_WIDTHS = ['var(--overview-skeleton-lead)', '34%'];

/** The change map's legend and the section titles: 12.5px text on a 1.5 line. */
const SMALL_LINE = 18.75;

/** The legend's two lines, kept and sized as the lead's are: its four keys on one line, or three and then one. */
const LEGEND_WIDTHS = ['var(--overview-skeleton-legend)', '18%'];

/** Pill widths for checks that have not answered yet. */
const PENDING_CHECKS = ['w-[86px]', 'w-[104px]', 'w-[72px]'];

/**
 * What a part whose count is not known draws: no decision or file rows,
 * since another review's would be a guess, and two summary lines' bars,
 * which the CSS cuts to the one or two a short summary takes at the column's
 * width.
 */
const FIRST_VISIT: Shape = [0, 0, 2];

/**
 * Each part's count when nothing set it: no rows, and the summary's lines
 * for the column's width (review-overview.css).
 */
const FALLBACK = ['0', '0', 'var(--overview-skeleton-lines)'] as const;

/** Nothing to subscribe to: a skeleton keeps the shape it started with, and the review that lands replaces it. */
function subscribe(): () => void {
	return () => {};
}

/**
 * The shape kept for review `id`: null for a review with none kept, and
 * undefined in a server render and the render that hydrates it, which can't
 * read storage; the skeleton then reads {@link SHAPE_SCRIPT}'s variables
 * from `<html>` instead.
 */
function useShape(id: string): Shape | null | undefined {
	return useSyncExternalStore(
		subscribe,
		() => shapeFor(id),
		() => undefined
	);
}

/**
 * True for a skeleton that first rendered in the browser after hydration,
 * as one does when a review opens from inside the app; false for the one in
 * the server's frame and the render that hydrates it.
 */
function useDrawnHere(): boolean {
	const here = useSyncExternalStore(
		subscribe,
		() => true,
		() => false
	);

	const [first] = useState(here);

	return first;
}

/** Each part's count: undefined before React can read storage, null for a part whose count is not known. */
type Counts = readonly [number | null | undefined, number | null | undefined, number | null | undefined];

/**
 * What each part draws: the kept shape; else, for a skeleton drawn in the
 * browser, the rows the saved queue suggests, with the summary's lines not
 * known. A skeleton the server drew never takes the guess, since the frame
 * before hydration could not read it, so it never changes as the app
 * hydrates.
 */
function useCounts(id: string): Counts {
	const shape = useShape(id);
	const here = useDrawnHere();

	if (shape !== null) return shape ?? [undefined, undefined, undefined];

	const guess = here ? guessRows(id) : null;

	return [guess?.[0] ?? null, guess?.[1] ?? null, null];
}

interface PartProps {
	/** The part's count: undefined before React can read storage, null when not known. */
	count: number | null | undefined;
	/** Which part of the shape: 0 decisions, 1 files, 2 summary lines. */
	part: 0 | 1 | 2;
	className: string;
	children: (count: number) => ReactNode;
}

/**
 * One part of the skeleton, as tall as its count of rows or lines, which it
 * sets as `--rows` for its CSS (`.review-skeleton-clip`). It draws bars for
 * at most {@link MOST} of them and holds the rest's height empty. Before
 * React can read storage it draws the most bars, cut to the count the shape
 * script set, or to the part's fallback when none is kept; once hydrated it
 * draws the count itself, in the same elements, so no bar restarts its wait.
 * A part whose count is not known draws no rows, and summary lines the CSS
 * fits to the column. A part with nothing to draw leaves nothing, as the
 * page does.
 */
function Part({ count, part, className, children }: PartProps) {
	const rows = count === undefined ? `var(${SHAPE_VARS[part]}, ${FALLBACK[part]})` : String(count ?? FALLBACK[part]);
	const bars = Math.min(count === undefined ? MOST[part] : (count ?? FIRST_VISIT[part]), MOST[part]);

	if (bars === 0) return null;

	return (
		<div className={`${className} review-skeleton-clip`} style={{ '--rows': rows } as CSSProperties}>
			{children(bars)}
		</div>
	);
}

/**
 * The rail's style: once React has read storage, whether a stacked rail
 * holds its full height while its rows are not known, or takes their height.
 * Before that, `<html>` says, from the shape script.
 */
function railStyle([decisions, files]: Counts): CSSProperties | undefined {
	if (decisions === undefined) return undefined;

	return { [RAIL_MIN_VAR]: decisions !== null && files !== null ? '0px' : 'initial' } as CSSProperties;
}

/** The CI row while the forge answers: pills at their real height, invisible for the skeleton wait. */
export function CiSkeleton() {
	return (
		<div className="ci" aria-hidden>
			{PENDING_CHECKS.map((width) => (
				<Skeleton key={width} className={`h-[26px] rounded-[8px] ${width}`} />
			))}
		</div>
	);
}

/**
 * Checked for you while the forge answers, for a review with no receipts:
 * its title and pills hold the place the checks land in, so they never
 * appear below the page later. Checks that turn out to be none give the place
 * back at the end of the page, where nothing moves. The title's bar sits in
 * the title's own row, so it starts at the left edge as the title does. The
 * review's skeleton ends with it too, so the page lands on it.
 */
export function CheckedSkeleton() {
	return (
		<div className="overview-block" aria-hidden>
			<div className="overview-section-title">
				<SkeletonText count={1} widths={['104px']} lineHeight={SMALL_LINE} />
			</div>
			<CiSkeleton />
		</div>
	);
}

/**
 * The review page while it loads, laid out like the page it turns into: the
 * 44px header; the rail with the overview row, Needs you and Files at their
 * real heights; and the overview's summary, change map, the Needs you block
 * with its button where the overview puts it, and the checks' place. Each
 * part draws as many rows or lines as review `id` had when it last loaded
 * here. A review with none kept, opened from inside the app, draws the rows
 * its queue row suggests. Otherwise it draws the rail's fixed rows and the
 * Needs you heading alone, since rows another review had would be a guess,
 * and a rail stacked over the pane holds its full height, which most
 * reviews' rows fill. The overview's lead, legend and button row wrap where
 * the page's do, by the column's width. Its bars stay invisible for the
 * skeleton wait, so a fast load never flashes them, and the page swaps in
 * place with no entrance motion. A return visit paints from the kept copy
 * and never shows it. Route waits are short and the router announces the
 * page that lands, so it is marked busy and announces nothing itself.
 */
export function ReviewSkeleton({ id }: { id: string }) {
	const counts = useCounts(id);

	return (
		<div data-ui="review-page" className="review-page" aria-busy="true">
			{counts[0] === undefined ? <script dangerouslySetInnerHTML={{ __html: SHAPE_SCRIPT }} /> : null}
			<PanelHeader className="review-head gap-3 pr-2.5 pl-[18px]">
				<Skeleton className="h-[13px] w-[38px]" />
				<Skeleton className="h-[14px] w-[min(380px,40%)]" />
				<Skeleton className="h-[11px] w-[min(240px,20%)]" />
			</PanelHeader>
			<div className="review-body">
				<div className="rail rail-skeleton" style={railStyle(counts)}>
					<div className="rail-list">
						<div className="rail-skeleton-overview">
							<Skeleton className="size-[15px] shrink-0 rounded-[4px]" />
							<Skeleton className="w-[64px]" />
							<Skeleton className="h-[4px] flex-1 rounded-full" />
						</div>
						<div className="rail-heading">
							<SkeletonText count={1} widths={['64px']} lineHeight={HEADING_LINE} barHeight={10} />
						</div>
						<Part count={counts[0]} part={0} className="rail-skeleton-decisions">
							{(count) => (
								<SkeletonRows
									count={count}
									height={DECISION_ROW}
									glyph
									widths={DECISION_WIDTHS}
									rowClassName="rail-skeleton-row"
									className="rail-list"
								/>
							)}
						</Part>
						<Part count={counts[1]} part={1} className="rail-skeleton-files">
							{(count) => (
								<>
									<div className="rail-heading">
										<SkeletonText count={1} widths={['36px']} lineHeight={HEADING_LINE} barHeight={10} />
									</div>
									<SkeletonRows
										count={count}
										height={FILE_ROW}
										lines={1}
										widths={FILE_WIDTHS}
										rowClassName="rail-skeleton-file"
										className="rail-list"
									/>
								</>
							)}
						</Part>
					</div>
				</div>
				<div className="review-main review-skeleton-main">
					<div className="overview w-full">
						<Part count={counts[2]} part={2} className="overview-skeleton-summary">
							{(count) => <SkeletonText count={count} widths={SUMMARY_WIDTHS} lineHeight={INTENT_LINE} />}
						</Part>
						<div className="overview-block">
							<SkeletonText
								count={2}
								widths={LEAD_WIDTHS}
								lineHeight={LEAD_LINE}
								className="overview-lead overview-skeleton-lead"
							/>
							<Skeleton className="h-[6px] rounded-full" />
							<SkeletonText
								count={2}
								widths={LEGEND_WIDTHS}
								lineHeight={SMALL_LINE}
								className="overview-skeleton-legend"
							/>
						</div>
						<div className="overview-block">
							<div className="overview-section-title">
								<SkeletonText count={1} widths={['62px']} lineHeight={SMALL_LINE} />
							</div>
							<div className="overview-start overview-skeleton-start">
								<Skeleton className="h-[calc(var(--size-control-md)-2px)] w-[176px] rounded-[8px]" />
								<Skeleton className="h-[10px] w-[120px]" />
							</div>
						</div>
						<CheckedSkeleton />
					</div>
				</div>
			</div>
		</div>
	);
}
