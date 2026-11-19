import { describe, expect, test } from 'bun:test';

import { splitPairs } from '../../src/components/content/split-pairs';

const at = (types: string) =>
	[...types].map((type) => ({ type: type === 'c' ? 'context' : type === 'd' ? 'del' : 'add' }) as const);

describe('splitPairs', () => {
	test('a context line stands on both sides', () => {
		expect(splitPairs(at('cc'))).toEqual([
			{ old: 0, new: 0 },
			{ old: 1, new: 1 }
		]);
	});

	test('removed lines pair with the added lines after them, row by row', () => {
		expect(splitPairs(at('cdda'))).toEqual([
			{ old: 0, new: 0 },
			{ old: 1, new: 3 },
			{ old: 2, new: null }
		]);
	});

	test('an addition with nothing removed before it faces an empty row', () => {
		expect(splitPairs(at('caac'))).toEqual([
			{ old: 0, new: 0 },
			{ old: null, new: 1 },
			{ old: null, new: 2 },
			{ old: 3, new: 3 }
		]);
	});

	test('an addition before a removal stays in its own row', () => {
		expect(splitPairs(at('ad'))).toEqual([
			{ old: null, new: 0 },
			{ old: 1, new: null }
		]);
	});
});
