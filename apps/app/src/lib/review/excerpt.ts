import type { DiffHunk, DiffLine, FileDiff } from '@recoder/shared';

/** A diff line as the code views draw it; `flagged` marks the range an item points at. */
export interface ExcerptLine extends DiffLine {
	flagged: boolean;
}

interface Excerpt {
	lines: ExcerptLine[];
	/** Diff lines left out above and below the window. */
	above: number;
	below: number;
}

/** One hunk of a file (or a run of one, once folded), with what the view leaves out before it. */
export interface FileHunk {
	lines: ExcerptLine[];
	/** Unchanged lines between this hunk and the hunk before (or the file's top). */
	skipped: number;
	/** Diff lines a fold hides just before this run. */
	folded: number;
}

/** A long diff cut down by `foldHunks`. */
interface FoldedHunks {
	runs: FileHunk[];
	/** Diff lines hidden after the last run. */
	after: number;
}

function lineNo(line: DiffLine, side: 'old' | 'new'): number | null {
	return side === 'old' ? line.oldNo : line.newNo;
}

/** The first and last flat index of each hunk, so a window never runs from one hunk into the next. */
function hunkBounds(file: FileDiff): { owner: number[]; start: number[]; end: number[] } {
	const owner: number[] = [];
	const start: number[] = [];
	const end: number[] = [];

	file.hunks.forEach((hunk, index) => {
		start.push(owner.length);

		for (let at = 0; at < hunk.lines.length; at++) owner.push(index);

		end.push(owner.length - 1);
	});

	return { owner, start, end };
}

/**
 * The diff lines around `line..endLine`, `radius` lines either side, with the
 * range flagged. The window stays inside the hunks that hold the range, since
 * the lines between hunks are not in the diff. A location outside the diff,
 * or none, shows the start of the first hunk.
 */
export function excerpt(
	file: FileDiff,
	line: number | null,
	endLine: number | null,
	side: 'old' | 'new',
	radius = 4
): Excerpt {
	const all = file.hunks.flatMap((hunk) => hunk.lines);
	const { owner, start, end } = hunkBounds(file);
	const from = line ?? -1;
	const to = endLine ?? line ?? -1;

	const hits = all.flatMap((diffLine, index) => {
		const no = lineNo(diffLine, side);

		return no !== null && no >= from && no <= to ? [index] : [];
	});

	const head = hits[0];
	const tail = hits[hits.length - 1];
	const first = hits.length ? Math.max(start[owner[head]], head - radius) : 0;
	const last = hits.length ? Math.min(end[owner[tail]], tail + radius) : Math.min(end[0] ?? -1, radius * 3);
	const flagged = new Set(hits);

	return {
		lines: all
			.slice(first, last + 1)
			.map((diffLine, offset) => ({ ...diffLine, flagged: flagged.has(first + offset) })),
		above: first,
		below: Math.max(0, all.length - 1 - last)
	};
}

/** The first new-side line a hunk covers; a hunk that adds nothing names the line before it. */
function firstNew(hunk: DiffHunk): number {
	return hunk.newCount === 0 ? hunk.newStart + 1 : hunk.newStart;
}

/** True when a new-side line number falls inside any of the ranges. */
function inRanges(no: number | null, ranges: { line: number | null; endLine: number | null }[]): boolean {
	return no !== null && ranges.some(({ line, endLine }) => line !== null && no >= line && no <= (endLine ?? line));
}

/**
 * A file's diff hunk by hunk, with new-side lines inside any of `ranges`
 * flagged, and how many unchanged lines sit before each hunk.
 */
export function fileHunks(file: FileDiff, ranges: { line: number | null; endLine: number | null }[]): FileHunk[] {
	return file.hunks.map((hunk, index) => {
		const before = file.hunks[index - 1];
		const resumes = before ? firstNew(before) + before.newCount : 1;

		return {
			lines: hunk.lines.map((line) => ({ ...line, flagged: line.type !== 'del' && inRanges(line.newNo, ranges) })),
			skipped: Math.max(0, firstNew(hunk) - resumes),
			folded: 0
		};
	});
}

/** Marks the flat line indexes a fold keeps: the first `shown`, and `radius` either side of each anchored line. */
function keptLines(lines: ExcerptLine[], anchored: (line: ExcerptLine) => boolean, shown: number, radius: number) {
	const kept = new Uint8Array(lines.length);

	kept.fill(1, 0, shown);

	lines.forEach((line, at) => {
		if (anchored(line)) kept.fill(1, Math.max(0, at - radius), at + radius + 1);
	});

	return kept;
}

/**
 * A long diff cut down to its first `shown` lines plus `radius` lines around
 * each anchored line (a flagged range, a line a decision ends on), so a
 * lockfile or a generated file never renders in full. Each run says how many
 * diff lines the fold hid before it. A run that opens a hunk right after the
 * last one keeps the hunk's unchanged-line count; after a fold that count is
 * dropped, since the fold row already marks the jump.
 */
export function foldHunks(
	hunks: FileHunk[],
	anchored: (line: ExcerptLine) => boolean,
	shown: number,
	radius: number
): FoldedHunks {
	const kept = keptLines(
		hunks.flatMap((hunk) => hunk.lines),
		anchored,
		shown,
		radius
	);

	const runs: FileHunk[] = [];
	let folded = 0;
	let flat = 0;

	for (const hunk of hunks) {
		let run: FileHunk | null = null;

		hunk.lines.forEach((line, at) => {
			if (!kept[flat + at]) {
				run = null;
				folded += 1;

				return;
			}

			if (!run) {
				run = { lines: [], skipped: at === 0 && folded === 0 ? hunk.skipped : 0, folded };
				runs.push(run);
				folded = 0;
			}

			run.lines.push(line);
		});

		flat += hunk.lines.length;
	}

	return { runs, after: folded };
}
