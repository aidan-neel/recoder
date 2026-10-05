import type { LabeledDefect, PrScore } from '../../src/eval/benchmark-score';

/** A planted bug in `src/a.ts`. */
export const defect: LabeledDefect = {
	id: 'd1',
	kind: 'bug',
	category: 'correctness',
	file: 'src/a.ts',
	line: 10,
	title: 'bug',
	description: '',
	fix: ''
};

/** A score that found the defects at the given finding indices and nothing else. */
export function score(found: Record<string, number>): PrScore {
	return { found, reasons: {}, missed: [], duplicates: [], unlabeled: [] };
}
