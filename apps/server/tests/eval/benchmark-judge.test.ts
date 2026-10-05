import { expect, test } from 'bun:test';
import { judgePr, scoreVerdicts } from '../../src/eval/benchmark-judge';
import type { LabeledDefect } from '../../src/eval/benchmark-score';

function defect(id: string): LabeledDefect {
	return { id, kind: 'bug', category: 'correctness', file: 'src/a.ts', line: 10, title: id, description: '', fix: '' };
}

const verdict = (defectId: string, finding: number | null, duplicates: number[] = []) => ({
	defect: defectId,
	finding,
	duplicates,
	reason: ''
});

test('a finding the judge gives to two defects counts only for the first', () => {
	const score = scoreVerdicts({ matches: [verdict('d1', 0), verdict('d2', 0)] }, [defect('d1'), defect('d2')], 1);

	expect(score.found).toEqual({ d1: 0 });
	expect(score.missed).toEqual(['d2']);
});

test('an out-of-range finding index or unknown defect id earns no credit', () => {
	const score = scoreVerdicts({ matches: [verdict('d1', 5, [9]), verdict('d9', 0)] }, [defect('d1')], 2);

	expect(score.found).toEqual({});
	expect(score.missed).toEqual(['d1']);
	expect(score.unlabeled).toEqual([0, 1]);
});

test('duplicates are only findings no defect claimed as its match', () => {
	const score = scoreVerdicts(
		{ matches: [verdict('d1', 0, [1, 2]), verdict('d2', 2), verdict('d3', null)] },
		[defect('d1'), defect('d2'), defect('d3')],
		4
	);

	expect(score.found).toEqual({ d1: 0, d2: 2 });
	expect(score.duplicates).toEqual([1]);
	expect(score.unlabeled).toEqual([3]);
	expect(score.missed).toEqual(['d3']);
});

test('a run with no findings misses every defect without asking the judge', async () => {
	const score = await judgePr(() => Promise.reject(new Error('called')), [defect('d1')], []);

	expect(score.missed).toEqual(['d1']);
});
