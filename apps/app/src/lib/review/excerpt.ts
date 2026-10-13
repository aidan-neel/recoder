import type { DiffLine, FileDiff } from '@recoder/shared';

export interface ExcerptLine {
	line: DiffLine;
	/** Inside the range the item points at. */
	flagged: boolean;
}

export interface Excerpt {
	lines: ExcerptLine[];
	/** Diff lines left out above and below the window. */
	above: number;
	below: number;
}

function lineNo(line: DiffLine, side: 'old' | 'new'): number | null {
	return side === 'old' ? line.oldNo : line.newNo;
}

/**
 * The diff lines around `line..endLine`, `radius` lines either side, with the
 * range flagged. A location outside the diff, or none, shows the diff's start.
 */
export function excerpt(
	file: FileDiff,
	line: number | null,
	endLine: number | null,
	side: 'old' | 'new',
	radius = 4
): Excerpt {
	const all = file.hunks.flatMap((hunk) => hunk.lines);
	const from = line ?? -1;
	const to = endLine ?? line ?? -1;

	const hits = all.flatMap((diffLine, index) => {
		const no = lineNo(diffLine, side);

		return no !== null && no >= from && no <= to ? [index] : [];
	});

	const first = hits.length ? Math.max(0, hits[0] - radius) : 0;

	const last = hits.length
		? Math.min(all.length - 1, hits[hits.length - 1] + radius)
		: Math.min(all.length - 1, radius * 3);

	const flagged = new Set(hits);

	return {
		lines: all
			.slice(first, last + 1)
			.map((diffLine, offset) => ({ line: diffLine, flagged: flagged.has(first + offset) })),
		above: first,
		below: all.length - 1 - last
	};
}

/** Every line of a file's diff, with new-side lines inside any of `ranges` flagged. */
export function fileLines(file: FileDiff, ranges: { line: number | null; endLine: number | null }[]): ExcerptLine[] {
	const inRange = (no: number | null) =>
		no !== null && ranges.some(({ line, endLine }) => line !== null && no >= line && no <= (endLine ?? line));

	return file.hunks.flatMap((hunk) =>
		hunk.lines.map((line) => ({ line, flagged: line.type !== 'del' && inRange(line.newNo) }))
	);
}
