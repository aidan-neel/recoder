import { expect, test } from 'bun:test';
import { summarize } from '../../src/eval/benchmark-score';
import { defect, score } from '../helpers/benchmark';

test('a defect found in one of two runs halves recall and counts as unstable', () => {
	const summary = summarize([{ codebase: 'ky', defects: [defect], scores: [score({ d1: 0 }), score({})] }]);

	expect(summary.overall).toEqual({ planted: 2, found: 1 });
	expect(summary.defectStability).toBe(0);
});

test('a defect only a hidden candidate reported counts as lost', () => {
	const hidden = { ...score({ d1: 1 }), unlabeled: [0] };

	const summary = summarize([
		{
			codebase: 'ky',
			defects: [defect],
			scores: [score({}), score({ d1: 0 })],
			hiddenRuns: [
				{ shown: score({}), hidden },
				{ shown: score({ d1: 0 }), hidden }
			]
		}
	]);

	expect(summary.hidden).toEqual({ candidates: 4, matched: 2, lost: 1 });
});
