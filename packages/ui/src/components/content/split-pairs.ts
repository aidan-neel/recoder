import type { CodeLine } from './code-lines';

/** One row of a split diff: the index of the line on each side, or null where that side has none. */
export interface SplitPair {
	old: number | null;
	new: number | null;
}

/**
 * The rows of a split diff. A context line stands on both sides; a run of removed lines and the run of added lines
 * after it pair up row by row, and the longer run's tail faces empty rows.
 */
export function splitPairs(lines: readonly Pick<CodeLine, 'type'>[]): SplitPair[] {
	const pairs: SplitPair[] = [];
	let index = 0;

	while (index < lines.length) {
		if (lines[index].type === 'context') {
			pairs.push({ old: index, new: index });
			index += 1;

			continue;
		}

		const dels: number[] = [];
		const adds: number[] = [];

		while (index < lines.length && lines[index].type === 'del') dels.push(index++);
		while (index < lines.length && lines[index].type === 'add') adds.push(index++);

		for (let row = 0; row < Math.max(dels.length, adds.length); row += 1) {
			pairs.push({ old: dels[row] ?? null, new: adds[row] ?? null });
		}
	}

	return pairs;
}
