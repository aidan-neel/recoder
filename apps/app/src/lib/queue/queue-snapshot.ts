import { reviewListItem, type ProgressSummaries, type Repo } from '@recoder/shared';
import { useSyncExternalStore } from 'react';

import { API_BASE } from '../api/http';
import { storedStyleScript, wholeIn } from '../shell/boot-vars';
import { SAVED_LIST_MAX_AGE_MS } from '../shell/saved-bar';
import type { QueueEntry } from './queue';
import type { MissingRepo } from './queue-fetch';
import { queueNotes } from './queue-notes';

/**
 * The live queue as the last visit left it, so the next visit paints it at
 * once while a refresh runs. It holds only what the rows show.
 */
export interface QueueSnapshot {
	/** When the list loaded. */
	at: number;
	repos: Repo[];
	entries: QueueEntry[];
	missing: MissingRepo[];
	progress: ProgressSummaries;
}

/** What storage holds: the snapshot, and the server it came from, so another server's list never shows. */
interface Stored extends QueueSnapshot {
	api: string;
}

/**
 * The loading skeleton's shape: its rows, and the note lines it keeps room
 * for under the headline. The rest is what the last list measured on screen,
 * since text wraps differently at another window width: the headline's lines
 * hold only at the width they were measured at, the notes' height across its
 * band (see {@link NARROW_BELOW}).
 */
interface SkeletonShape {
	rows: number;
	notes: number;
	/** The window's inner width when the parts below were measured. */
	width?: number;
	/** The lines the headline took. */
	brief?: number;
	/** How tall the note lines were, in CSS px (as at the root font's 16px), when they were the notes `notes` counts. */
	notesHeight?: number;
}

/** What the page measures of a list on screen (see {@link keepMeasure}). */
interface Measure {
	brief: number;
	/** How many notes showed under the headline, and how tall they were together, in CSS px. */
	notes: number;
	notesHeight: number;
}

const STORAGE_KEY = 'recoder.app.queue.v1';

/**
 * Where the last list's shape is kept for the skeleton, apart from the list,
 * so the script that reads it before first paint parses a few bytes instead
 * of the whole list.
 */
const SHAPE_KEY = 'recoder.app.queue-shape.v1';

/** The skeleton's rows before the queue has ever loaded (the fallback of `--queue-skeleton-rows` in queue.css)... */
const DEFAULT_ROWS = 5;

/**
 * ...and its note lines (the fallback of `--queue-skeleton-notes`): one, for
 * a repository whose pull requests did not load. A list without that note
 * moves up by one line when it lands, once; every later visit has its shape.
 */
const DEFAULT_NOTES = 1;

/** ...and never more than this, whatever the last list held. */
export const MAX_ROWS = 8;

/** The most note lines the skeleton keeps room for. */
export const MAX_NOTES = 3;

/** The most headline lines the skeleton keeps room for. */
export const MAX_BRIEF = 3;

/** The tallest the note lines are taken to be, in px; a taller measure is not kept. */
const MAX_NOTES_HEIGHT = 400;

/**
 * Windows narrower than this wrap a note's line (the default under it is the
 * wrapped height, in queue.css), wider ones mostly do not: a notes height
 * measured on one side holds at any width on that side, at any root font size.
 */
const NARROW_BELOW = 450;

/** The stored snapshot, read once per page load and then kept here; undefined until the first read. */
let stored: Stored | null | undefined;

/** The stored shape, read once per page load and then kept here; undefined until the first read. */
let shape: SkeletonShape | null | undefined;

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A row that has what the queue reads first; anything else reads as a broken snapshot. */
function validEntry(value: unknown): boolean {
	return (
		isObject(value) &&
		typeof value.key === 'string' &&
		typeof value.state === 'string' &&
		isObject(value.pull) &&
		typeof value.pull.number === 'number' &&
		(value.review === null || isObject(value.review))
	);
}

/** A stored value with every part in place, or null for a missing, older-format or hand-edited one. */
function parse(text: string | null): Stored | null {
	try {
		const value: unknown = JSON.parse(text ?? 'null');

		if (!isObject(value) || typeof value.at !== 'number' || typeof value.api !== 'string') return null;
		if (!Array.isArray(value.repos) || !Array.isArray(value.missing) || !isObject(value.progress)) return null;
		if (!Array.isArray(value.entries) || !value.entries.every(validEntry)) return null;

		return value as unknown as Stored;
	} catch {
		return null;
	}
}

function read(): Stored | null {
	if (stored !== undefined) return stored;

	try {
		stored = parse(localStorage.getItem(STORAGE_KEY));
	} catch {
		stored = null;
	}

	return stored;
}

/** The live queue the last visit saved, when it came from this server within the last day. */
export function readSnapshot(): QueueSnapshot | null {
	const snapshot = read();

	if (!snapshot || snapshot.api !== API_BASE || Date.now() - snapshot.at > SAVED_LIST_MAX_AGE_MS) return null;

	return snapshot;
}

/**
 * The repositories of the live queue the last visit saved from this server,
 * however old: a list too old to paint still names the repositories whose
 * pull requests the next load can ask for beside the repository list.
 */
export function savedRepos(): Repo[] {
	const snapshot = read();

	return snapshot?.api === API_BASE ? snapshot.repos : [];
}

/**
 * Keeps the live queue for the next visit, each review cut to the fields its
 * row reads: one may have come whole, from the review page or a server too
 * old to list summaries. Storage that is full or blocked only costs the next
 * visit its instant paint.
 */
export function saveSnapshot(snapshot: QueueSnapshot): void {
	const entries = snapshot.entries.map((entry) =>
		entry.review ? { ...entry, review: reviewListItem(entry.review) } : entry
	);

	const next: Stored = { ...snapshot, entries, api: API_BASE };

	stored = next;

	try {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
	} catch {}

	saveShape(
		withCounts(Math.min(MAX_ROWS, Math.max(1, entries.length)), Math.min(MAX_NOTES, noteLines(snapshot.missing)))
	);
}

/**
 * Forgets the saved queue and its shape: the server tracks nothing, or the
 * page broke on the rows it held. The next read checks storage again.
 */
export function clearSnapshot(): void {
	stored = undefined;
	shape = undefined;

	try {
		localStorage.removeItem(STORAGE_KEY);
		localStorage.removeItem(SHAPE_KEY);
	} catch {}
}

/** The note lines the repositories that failed make under the headline: the notes a list the last visit saved paints with. */
function noteLines(missing: MissingRepo[]): number {
	return queueNotes(null, null, missing).length;
}

/**
 * The stored shape with new counts. What the page measured stays, since it
 * holds for the window it was measured in, but the notes' height only while
 * the notes are as many.
 */
function withCounts(rows: number, notes: number): SkeletonShape {
	const now = readShape();
	const { notesHeight, ...measured }: Partial<SkeletonShape> = now ?? {};

	return notesHeight !== undefined && now?.notes === notes
		? { ...measured, rows, notes, notesHeight }
		: { ...measured, rows, notes };
}

/** A whole number from `min` to `max`, or null. */
function count(value: unknown, min: number, max: number): number | null {
	return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max ? value : null;
}

/** A height in px from 0 to {@link MAX_NOTES_HEIGHT}, or null. */
function height(value: unknown): number | null {
	return typeof value === 'number' && value >= 0 && value <= MAX_NOTES_HEIGHT ? value : null;
}

/** The measured parts of a stored shape that are well formed, with the width they hold at; none without a width. */
function parseMeasured(value: Record<string, unknown>): Partial<SkeletonShape> {
	const width = count(value.width, 1, Number.MAX_SAFE_INTEGER);
	const brief = count(value.brief, 1, MAX_BRIEF);
	const notesHeight = height(value.notesHeight);

	if (width === null) return {};

	return { width, ...(brief === null ? {} : { brief }), ...(notesHeight === null ? {} : { notesHeight }) };
}

/** A stored shape with both counts in range, or null for a missing or hand-edited one. */
function parseShape(text: string | null): SkeletonShape | null {
	try {
		const value: unknown = JSON.parse(text ?? 'null');

		if (!isObject(value)) return null;

		const rows = count(value.rows, 1, MAX_ROWS);
		const notes = count(value.notes, 0, MAX_NOTES);

		return rows === null || notes === null ? null : { rows, notes, ...parseMeasured(value) };
	} catch {
		return null;
	}
}

function readShape(): SkeletonShape | null {
	if (shape !== undefined) return shape;

	try {
		shape = parseShape(localStorage.getItem(SHAPE_KEY));
	} catch {
		shape = null;
	}

	return shape;
}

/** Keeps the list's shape for the next skeleton. Storage that is full or blocked only costs that skeleton its shape. */
function saveShape(next: SkeletonShape): void {
	const text = JSON.stringify(next);

	if (JSON.stringify(readShape()) === text) return;

	shape = next;

	try {
		localStorage.setItem(SHAPE_KEY, text);
	} catch {}
}

/**
 * Keeps what the page measured of the live list on screen, at this window
 * width: the headline's lines, and the notes' height in CSS px when they were
 * the notes the shape counts (a setup note or a failed refresh adds lines the
 * next load does not open with). A list that never saved its shape keeps
 * nothing.
 */
export function keepMeasure({ brief, notes, notesHeight }: Measure): void {
	const now = readShape();
	const lines = count(brief, 1, MAX_BRIEF);

	if (!now || lines === null) return;

	const kept = height(Math.round(notesHeight * 10) / 10);
	const { notesHeight: _old, ...counts } = now;

	saveShape({
		...counts,
		width: window.innerWidth,
		brief: lines,
		...(notes === now.notes && kept !== null ? { notesHeight: kept } : {})
	});
}

/**
 * A script for the server's HTML, placed in the skeleton ahead of its bars,
 * that runs before first paint: it copies the last list's shape onto
 * `<html>` as CSS variables, which cut the most rows, note lines and
 * headline lines the skeleton draws to that shape (`.queue-skeleton-rows`,
 * `.queue-skeleton-notes` and `.queue-skeleton-brief` in queue.css), and
 * hide the notes for a list that had none. The headline's lines apply only
 * at the width they were measured at, the notes' height across its band.
 * Nothing stored leaves the variables' fallbacks: five rows, one note line
 * (wrapped below 450px) and a one-line headline (two below 451px). It
 * mirrors {@link parseShape} and {@link measuredHere}.
 */
export const SHAPE_SCRIPT = storedStyleScript(
	SHAPE_KEY,
	`v&&${wholeIn('v.rows', 1, MAX_ROWS)}&&${wholeIn('v.notes', 0, MAX_NOTES)}`,
	`s.setProperty('--queue-skeleton-rows',String(v.rows));s.setProperty('--queue-skeleton-notes',String(v.notes));if(v.notes===0)s.setProperty('--queue-skeleton-if-notes','none');if(typeof v.width!=='number')return;if(v.width===innerWidth&&${wholeIn('v.brief', 1, MAX_BRIEF)})s.setProperty('--queue-skeleton-brief',String(v.brief));var h=v.notesHeight;if((v.width<${NARROW_BELOW})===(innerWidth<${NARROW_BELOW})&&typeof h==='number'&&h>=0&&h<=${MAX_NOTES_HEIGHT})s.setProperty('--queue-skeleton-notes-height',h/16+'rem');`
);

/** How many rows the loading skeleton shows: as many as the list last had, from one to eight, or five before it ever loaded. */
function skeletonRows(): number {
	return readShape()?.rows ?? DEFAULT_ROWS;
}

/** How many note lines the skeleton keeps room for: as many as the last list had (one before it ever loaded), so the rows land where its bars were. */
function skeletonNotes(): number {
	return readShape()?.notes ?? DEFAULT_NOTES;
}

/** Whether the last list was measured at this window width, or only on the same side of {@link NARROW_BELOW}. */
function measuredHere(exact: boolean): SkeletonShape | null {
	const now = readShape();
	const width = window.innerWidth;

	if (now?.width === undefined) return null;
	if (exact) return now.width === width ? now : null;

	return now.width < NARROW_BELOW === width < NARROW_BELOW ? now : null;
}

/** The headline's lines the last list took at this width, or undefined, which leaves them to CSS. */
function skeletonBrief(): number | undefined {
	return measuredHere(true)?.brief;
}

/**
 * How tall the last list's notes were in this width's band, in rem, so the
 * height grows with the root font as every CSS px does; or undefined, which
 * sizes them by their count.
 */
function skeletonNotesHeight(): string | undefined {
	const px = measuredHere(false)?.notesHeight;

	return px === undefined ? undefined : `${px / 16}rem`;
}

/** Nothing to subscribe to: the counts change only when a list lands, which replaces the skeleton reading them. */
function subscribe(): () => void {
	return () => {};
}

/** A server render, and the render that hydrates it, can't read storage. */
function unread(): undefined {
	return undefined;
}

/**
 * The loading skeleton's shape: its rows (see {@link skeletonRows}), the
 * note lines it keeps room for, and what the last list measured at this
 * width. All are undefined in a server render and the render that hydrates
 * it: the skeleton then draws the most of each, and {@link SHAPE_SCRIPT}
 * cuts them to the stored shape before first paint.
 */
export function useSkeletonShape(): {
	rows: number | undefined;
	notes: number | undefined;
	brief: number | undefined;
	notesHeight: string | undefined;
} {
	const rows = useSyncExternalStore(subscribe, skeletonRows, unread);
	const notes = useSyncExternalStore(subscribe, skeletonNotes, unread);
	const brief = useSyncExternalStore(subscribe, skeletonBrief, unread);
	const notesHeight = useSyncExternalStore(subscribe, skeletonNotesHeight, unread);

	return { rows, notes, brief, notesHeight };
}
