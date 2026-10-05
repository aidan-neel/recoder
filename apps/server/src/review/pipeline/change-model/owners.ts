import type { DiffHunk } from '@recoder/shared';
import type { SymbolRange } from './types.js';

/** The changed lines of one hunk, on both sides of the diff. */
export interface HunkLines {
	id: string;
	/** New-side lines the hunk adds. */
	added: number[];
	/** Old-side lines the hunk deletes. */
	deleted: number[];
	/** New-side line `a` for each run of deletions that sat between lines `a` and `a + 1`. */
	gaps: number[];
}

/** Pairs inventory hunk ids with the parsed diff's lines; both lists are in the same order. */
export function hunkLines(ids: string[], hunks: DiffHunk[]): HunkLines[] {
	return ids.map((id, index) => {
		const hunk = hunks[index];
		const result: HunkLines = { id, added: [], deleted: [], gaps: [] };

		if (!hunk) return result;

		let previousNew = hunk.newStart - 1;

		for (const line of hunk.lines) {
			if (line.type === 'del') {
				if (line.oldNo !== null) result.deleted.push(line.oldNo);
				if (result.gaps.at(-1) !== previousNew) result.gaps.push(previousNew);
				continue;
			}

			if (line.newNo !== null) previousNew = line.newNo;
			if (line.type === 'add' && line.newNo !== null) result.added.push(line.newNo);
		}

		return result;
	});
}

/** Smaller ranges first; for equal sizes the later start (the inner one), then the earlier entry. */
function tighter(symbols: SymbolRange[], a: number, b: number): number {
	const left = symbols[a];
	const right = symbols[b];

	return left.endLine - left.startLine - (right.endLine - right.startLine) || right.startLine - left.startLine || a - b;
}

/** Index of the innermost symbol covering lines `from` to `to`, or -1 when none does. */
export function innermost(symbols: SymbolRange[], from: number, to = from): number {
	let best = -1;

	for (const [index, symbol] of symbols.entries()) {
		if (symbol.startLine > from || symbol.endLine < to) continue;
		if (best < 0 || tighter(symbols, index, best) < 0) best = index;
	}

	return best;
}
