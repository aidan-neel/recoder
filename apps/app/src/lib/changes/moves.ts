import type { DiffHunk, DiffMove, FileDiff } from '@recoder/shared';

/**
 * A block of lines the change moved or copied, as one side of the diff shows it. `from`: the block arrived here
 * from `other`, on the new side. `to`: the block left here for `other`, on the old side.
 */
export interface MoveSpan {
	direction: 'from' | 'to';
	kind: 'moved' | 'copied';
	/** Lines on this file's side: new lines for `from`, old lines for `to`. */
	start: number;
	end: number;
	/** True when the lines did not change on the way, so they read as old code and not as new. */
	exact: boolean;
	/**
	 * Where the block is on its other side: its old place for `from`, its new place for `to`. `path` is the file as
	 * the diff names it, and `inDiff` says whether the diff shows that file, so there is somewhere to go.
	 */
	other: { path: string; line: number; inDiff: boolean };
}

/** Moves with a known block on both sides; a whole renamed file is the file header's to show. */
function blockMoves(moves: readonly DiffMove[]): (DiffMove & { kind: 'moved' | 'copied' })[] {
	return moves.filter(
		(move): move is DiffMove & { kind: 'moved' | 'copied' } =>
			move.kind !== 'renamed-file' && move.toLines.end !== null && move.fromLines.end !== null
	);
}

/** The blocks that arrived in `file`, on its new side. */
function arrivals(file: FileDiff): MoveSpan[] {
	return blockMoves(file.moves ?? []).map((move) => ({
		direction: 'from',
		kind: move.kind,
		start: move.toLines.start,
		end: move.toLines.end ?? move.toLines.start,
		exact: move.exact,
		other: { path: move.fromPath, line: move.fromLines.start, inDiff: false }
	}));
}

/** The blocks that left `file` for another place, on its old side; a copy leaves its source where it was. */
function departures(file: FileDiff, moves: readonly DiffMove[]): MoveSpan[] {
	const oldPath = file.oldPath ?? file.path;

	return blockMoves(moves)
		.filter((move) => move.kind === 'moved' && move.fromPath === oldPath)
		.map((move) => ({
			direction: 'to',
			kind: move.kind,
			start: move.fromLines.start,
			end: move.fromLines.end ?? move.fromLines.start,
			exact: move.exact,
			other: { path: move.toPath, line: move.toLines.start, inDiff: false }
		}));
}

/** Names a span's other side as the diff does: a block's old place by the file's path now, if it was renamed. */
function placed(span: MoveSpan, files: readonly FileDiff[]): MoveSpan {
	const file = files.find((candidate) =>
		span.direction === 'from'
			? (candidate.oldPath ?? candidate.path) === span.other.path
			: candidate.path === span.other.path
	);

	return { ...span, other: { ...span.other, path: file?.path ?? span.other.path, inDiff: Boolean(file) } };
}

/** Every file's moved and copied blocks, both the ones that arrived in it and the ones that left it, by path. */
export function moveSpans(files: readonly FileDiff[]): Map<string, MoveSpan[]> {
	const moves = files.flatMap((file) => file.moves ?? []);

	return new Map(
		files.map((file) => [
			file.path,
			[...arrivals(file), ...departures(file, moves)]
				.map((span) => placed(span, files))
				.sort((a, b) => a.start - b.start)
		])
	);
}

/** The spans a hunk shows part of: an arrival by its new lines, a departure by its old lines. */
export function spansIn(hunk: DiffHunk, spans: readonly MoveSpan[]): MoveSpan[] {
	return spans.filter((span) => {
		const [start, count] = span.direction === 'from' ? [hunk.newStart, hunk.newCount] : [hunk.oldStart, hunk.oldCount];

		return count > 0 && span.start <= start + count - 1 && span.end >= start;
	});
}

/** True when a line is inside an exact move, so it reads as old code: an added line that arrived, or a removed one that left. */
export function isMovedLine(
	line: { type: string; oldNo: number | null; newNo: number | null },
	spans: readonly MoveSpan[]
): boolean {
	return spans.some((span) => {
		if (!span.exact) return false;

		const no =
			span.direction === 'from' ? (line.type === 'add' ? line.newNo : null) : line.type === 'del' ? line.oldNo : null;

		return no !== null && no >= span.start && no <= span.end;
	});
}
