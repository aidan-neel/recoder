import { reviewTally } from '@recoder/shared';
import { whenIdle } from '@recoder/ui';

import type { QueueEntry } from '../queue/queue';
import { readSnapshot, type QueueSnapshot } from '../queue/queue-snapshot';
import { storedStyleScript, wholeIn } from '../shell/boot-vars';
import { reviewId } from '../shell/routes';
import { isRunning, surfaceOf } from './review-state';
import { useReview } from './review-store';

/** What a review's skeleton draws: its decision rows, its file rows and its summary's lines. */
export type Shape = readonly [decisions: number, files: number, summary: number];

/** A review's rail rows: its decisions, then its files. */
type Rows = readonly [decisions: number, files: number];

/**
 * The most bars each part draws: enough decision or file rows to fill a rail
 * on a 4K screen, and a long summary on a phone. A part kept with more draws
 * this many and holds the rest's height empty, below the fold, so what comes
 * after it lands where the page puts it.
 */
export const MOST: Shape = [24, 48, 10];

/** The largest count kept for any part, so a hand-edited entry can't make a skeleton miles tall. */
const LARGEST = 999;

/** The CSS variables the shape script sets on `<html>`, one per part of {@link Shape}. */
export const SHAPE_VARS = [
	'--review-skeleton-decisions',
	'--review-skeleton-files',
	'--review-skeleton-summary'
] as const;

/**
 * The least height of a rail stacked over the pane (review.css): unset, the
 * rail's cap, which most reviews' rows fill, while a review's rows are not
 * known; `0px` once they are (kept, or guessed from the queue), so they size
 * it.
 */
export const RAIL_MIN_VAR = '--review-skeleton-rail-min';

/** How many reviews' shapes are kept, the latest last. */
const KEPT_SHAPES = 30;

const SHAPES_KEY = 'recoder.app.review-shapes.v1';

/** A kept shape: the review's id, then its {@link Shape}. */
interface Kept {
	id: string;
	shape: Shape;
}

/**
 * The kept shapes as last read or kept, with the stored text they came from,
 * so the same text gives the same arrays (a skeleton reads its shape on every
 * render) and a new text is read again. `unsaved` marks a list that storage
 * would not take (full or blocked): it stays for the rest of the session, so
 * the page still draws the shape it kept.
 */
let cache: { text: string | null; shapes: Kept[]; unsaved: boolean } | null = null;

/** A stored count, when it is a whole number of rows, cut to {@link LARGEST}. */
function count(value: unknown): number | null {
	return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? Math.min(value, LARGEST) : null;
}

/** One stored entry, `[id, decisions, files, summary]`; anything else reads as never stored. */
function keptEntry(value: unknown): Kept[] {
	if (!Array.isArray(value) || value.length !== 4 || typeof value[0] !== 'string') return [];

	const [decisions, files, summary] = [count(value[1]), count(value[2]), count(value[3])];

	if (decisions === null || files === null || summary === null) return [];

	return [{ id: value[0], shape: [decisions, files, summary] }];
}

/** The stored list, keeping its well-formed entries; text that is missing or not a JSON list reads as none. */
function parseShapes(text: string | null): Kept[] {
	try {
		const value: unknown = JSON.parse(text ?? '[]');

		return Array.isArray(value) ? value.flatMap(keptEntry) : [];
	} catch {
		return [];
	}
}

/** The kept shapes; storage that is blocked reads as the list last read or kept, else none. */
function keptShapes(): Kept[] {
	if (cache?.unsaved) return cache.shapes;

	let text: string | null;

	try {
		text = localStorage.getItem(SHAPES_KEY);
	} catch {
		return cache?.shapes ?? [];
	}

	if (!cache || cache.text !== text) cache = { text, shapes: parseShapes(text), unsaved: false };

	return cache.shapes;
}

/** Stores the list's text; false when storage is full or blocked. */
function stored(text: string): boolean {
	try {
		localStorage.setItem(SHAPES_KEY, text);

		return true;
	} catch {
		return false;
	}
}

/**
 * The shape kept for review `id`, or null for one this browser has none for:
 * another review's rows say nothing about this one's (a draft has none at
 * all). The same array each time, until a shape is kept.
 */
export function shapeFor(id: string | null): Shape | null {
	return keptShapes().find((entry) => entry.id === id)?.shape ?? null;
}

/**
 * Keeps a review's shape for its next load, the latest last, each count cut
 * to {@link LARGEST}. Storage that is full or blocked only loses the hint
 * for the next load: this session still draws it.
 */
export function keepShape(id: string, [decisions, files, summary]: Shape): void {
	const shape: Shape = [Math.min(decisions, LARGEST), Math.min(files, LARGEST), Math.min(summary, LARGEST)];
	const shapes = [...keptShapes().filter((entry) => entry.id !== id), { id, shape }].slice(-KEPT_SHAPES);
	const text = JSON.stringify(shapes.map((entry) => [entry.id, ...entry.shape]));

	cache = { text, shapes, unsaved: !stored(text) };
}

/**
 * How many lines the overview's summary takes on screen: none for a review
 * whose overview is its live view (a draft's conversation), or null while
 * the pane shows another item.
 */
function summaryLines(): number | null {
	const slot = document.querySelector('[data-pane-view="overview"][data-shown]');

	if (!slot) return null;

	const summary = slot.querySelector<HTMLElement>('[data-ui="overview"] .overview-intent');

	if (!summary) return 0;

	return Math.round(summary.offsetHeight / parseFloat(getComputedStyle(summary).lineHeight));
}

/** The summary's lines when review `id`'s overview shows at this address, else null. */
function summaryHere(id: string): number | null {
	return reviewId(location.pathname) === id ? summaryLines() : null;
}

/**
 * Review `id`'s decision and file counts once it is loaded and done; null
 * while it loads or runs, or once another review is loaded.
 */
function doneRows(id: string): Rows | null {
	const state = useReview.getState();
	const surface = state.id === id && state.status === 'ready' && !isRunning(state.review) ? surfaceOf(state) : null;

	return surface ? [surface.decisions.length, surface.files.length] : null;
}

/**
 * Keeps the shape of review `id`, shown and ready, for the next load that
 * draws its skeleton: its decision and file counts, and the summary's lines
 * as the overview shows them. The lines are read in the next frame, whose
 * layout the paint needs anyway, and again once the page is idle; the shape
 * is stored then. Off the overview the summary keeps the lines kept before,
 * and a review with none kept waits for a visit that shows its overview. A
 * review still at work keeps nothing, since its rows are still coming.
 * Returns the cleanup: a page left before it went idle stores what it read,
 * so leaving quickly still keeps the shape.
 */
export function keepShapeOf(id: string): () => void {
	let rows = doneRows(id);
	let lines = shapeFor(id)?.[2] ?? null;
	let done = false;

	const keep = () => {
		if (done) return;

		done = true;
		rows = doneRows(id) ?? rows;

		if (rows && lines !== null) keepShape(id, [...rows, lines]);
	};

	const frame = requestAnimationFrame(() => {
		lines = summaryHere(id) ?? lines;
	});

	const cancel = whenIdle(() => {
		lines = summaryHere(id) ?? lines;
		keep();
	}, 1000);

	return () => {
		cancelAnimationFrame(frame);
		cancel();
		keep();
	};
}

/** The guess last made, with the saved queue and the review it was made from, so the same pair gives the same array. */
let guessed: { snapshot: QueueSnapshot; id: string; rows: Rows | null } | null = null;

/**
 * The rows a queue row's review will have: none for a draft, and once it is
 * finished its decisions and its pull request's changed files. A row whose
 * review or count does not read as one (storage edited by hand) gives none.
 */
function rowsOf({ review, pull }: QueueEntry): Rows | null {
	if (!review || review.status === 'queued' || review.status === 'running') return null;
	if (review.status === 'draft') return [0, 0];

	const files = count(pull.changedFiles);

	try {
		return files === null ? null : [Math.min(reviewTally(review, {}).open, LARGEST), files];
	} catch {
		return null;
	}
}

/**
 * The rail rows review `id` most likely has, for a review with no shape
 * kept, from the queue the last visit saved: a draft has none, and a
 * finished review has every decision its row counts (with nothing decided,
 * all are open) and its pull request's changed files. A review still at
 * work, or one the saved queue does not hold, has no guess. The same array
 * each time, until the queue is saved again.
 */
export function guessRows(id: string): Rows | null {
	const snapshot = readSnapshot();

	if (!snapshot) return null;
	if (guessed?.snapshot === snapshot && guessed.id === id) return guessed.rows;

	const entry = snapshot.entries.find((row) => row.review?.id === id);

	guessed = { snapshot, id, rows: entry ? rowsOf(entry) : null };

	return guessed.rows;
}

/**
 * The script ahead of the server's skeleton, which runs before first paint:
 * it copies the shape kept for the address's review onto `<html>` as
 * {@link SHAPE_VARS}, and clears {@link RAIL_MIN_VAR}, so the first frame
 * already has the rows the page lands on. With none kept it sets nothing,
 * and the CSS draws a review with no kept shape. It mirrors {@link keptEntry}
 * and {@link shapeFor}.
 */
export const SHAPE_SCRIPT = storedStyleScript(
	SHAPES_KEY,
	'Array.isArray(v)',
	`var m=/^\\/review\\/([^/]+)\\/?$/.exec(location.pathname),id=m&&decodeURIComponent(m[1]),pick=null;v.forEach(function(e){if(!Array.isArray(e)||e.length!==4||e[0]!==id)return;for(var i=1;i<4;i++)if(!(${wholeIn('e[i]', 0)}))return;pick=e;});if(!pick)return;${JSON.stringify(SHAPE_VARS)}.forEach(function(n,i){s.setProperty(n,String(Math.min(pick[i+1],${LARGEST})));});s.setProperty(${JSON.stringify(RAIL_MIN_VAR)},'0px');`
);
