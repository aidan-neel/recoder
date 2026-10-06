import { expect, test } from 'bun:test';
import { judgePr, scoreVerdicts } from '../../src/eval/benchmark-judge';
import type { LabeledDefect } from '../../src/eval/benchmark-score';

function defect(id: string): LabeledDefect {
	return { id, kind: 'bug', category: 'correctness', file: 'src/a.ts', line: 10, title: id, description: '', fix: '' };
}

const verdict = (defectId: string, finding: number | null, duplicates: number[] = []) => ({
	defect: defectId,
	finding,
	behavior: 'returns the wrong item',
	cause: 'the index is taken before filtering',
	sameBehavior: true,
	sameCause: true,
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

test('a nearby finding the judge weighs for a defect but reads as another behavior earns no credit', () => {
	const nearby = { ...verdict('d1', 0, [1]), behavior: 'recomputes the list on every render', sameBehavior: false };
	const score = scoreVerdicts({ matches: [nearby] }, [defect('d1')], 2);

	expect(score.found).toEqual({});
	expect(score.unlabeled).toEqual([0, 1]);
	expect(score.notes?.d1).toMatchObject({ finding: 0, reports: false });
});

test("a verdict that does not say the behavior and cause are the defect's earns no credit", () => {
	const score = scoreVerdicts({ matches: [{ defect: 'd1', finding: 0 }] }, [defect('d1')], 1);

	expect(score.found).toEqual({});
});

test('a run with no findings misses every defect without asking the judge', async () => {
	const score = await judgePr(() => Promise.reject(new Error('called')), [defect('d1')], []);

	expect(score.missed).toEqual(['d1']);
});

test('a PR with no planted defect makes no judge call', async () => {
	let calls = 0;

	const result = await judgePr(
		async () => {
			calls++;

			return '{}';
		},
		[],
		[{ file: 'a.ts', message: 'm', severity: 'warning' }]
	);

	expect(calls).toBe(0);
	expect(result.unlabeled).toEqual([0]);
});
