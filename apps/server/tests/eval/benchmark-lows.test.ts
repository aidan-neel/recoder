import { expect, test } from 'bun:test';
import { lowsOfRun, sumLows } from '../../src/eval/benchmark-lows';
import { score } from '../helpers/benchmark';

const candidates = [
	{ id: 'a', publishedBy: 'reproduced' as const },
	{ id: 'b', publishedBy: 'rule' as const },
	{ id: 'c', publishedBy: 'rule' as const },
	{ id: 'd', publishedBy: 'rule' as const },
	{ id: 'e' }
];

test('published lows are counted by reason against the judge call on each shown finding', () => {
	const judged = { ...score({ d1: 1 }), duplicates: [2], unlabeled: [0, 3, 4] };
	const lows = lowsOfRun(['a', 'b', 'c', 'd', 'e'], candidates, judged);

	expect(lows.reproduced).toEqual({ published: 1, matched: 0, duplicates: 0, unlabeled: 1 });
	expect(lows.rule).toEqual({ published: 3, matched: 1, duplicates: 1, unlabeled: 1 });
});

test('a shown finding that was never below the bar is in no reason', () => {
	const lows = lowsOfRun(['e'], candidates, { ...score({ d1: 0 }), unlabeled: [] });

	expect(sumLows([lows])).toEqual({
		reproduced: { published: 0, matched: 0, duplicates: 0, unlabeled: 0 },
		rule: { published: 0, matched: 0, duplicates: 0, unlabeled: 0 }
	});
});

test('two defects matched by one finding count that finding once', () => {
	const lows = lowsOfRun(['b'], candidates, score({ d1: 0, d2: 0 }));

	expect(lows.rule.matched).toBe(1);
});

test('summing runs adds each reason across them', () => {
	const first = lowsOfRun(['b'], candidates, score({ d1: 0 }));
	const second = lowsOfRun(['a', 'b'], candidates, { ...score({}), unlabeled: [0, 1] });

	expect(sumLows([first, second])).toEqual({
		reproduced: { published: 1, matched: 0, duplicates: 0, unlabeled: 1 },
		rule: { published: 2, matched: 1, duplicates: 0, unlabeled: 1 }
	});
});
