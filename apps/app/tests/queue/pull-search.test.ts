import { describe, expect, test } from 'bun:test';

import { searchPulls } from '../../src/lib/queue/pull-search';
import { sampleQueue } from '../../src/lib/sample/sample-queue';

const numbers = (search: string) => searchPulls(sampleQueue(), search, 6).map((entry) => entry.pull.number);

describe('searchPulls', () => {
	test('puts the pull request whose number was typed first', () => {
		expect(numbers('214')[0]).toBe(214);
		expect(numbers('#207')).toEqual([207]);
	});

	test('ranks a title word over the same word in a branch or author, and needs every word to match', () => {
		expect(numbers('csv billing')).toEqual([205]);
		expect(numbers('csv nowhere')).toEqual([]);
		expect(numbers('devin')).toEqual([198]);
	});

	test('finds a title from letters typed in order, as for a typo or an abbreviation', () => {
		expect(numbers('rtlim')).toEqual([214]);
	});
});
