import { describe, expect, test } from 'bun:test';

import { searchPulls } from '../../src/lib/queue/pull-search';
import type { QueueEntry } from '../../src/lib/queue/queue';
import { sampleQueue } from '../../src/lib/sample/sample-queue';

const numbers = (search: string, entries = sampleQueue()) =>
	searchPulls(entries, search, 6).map((entry) => entry.pull.number);

/** The sample queue with some pull requests retitled, by number. */
function retitled(titles: Record<number, string>): QueueEntry[] {
	return sampleQueue().map((entry) => {
		const title = titles[entry.pull.number];

		return title ? { ...entry, pull: { ...entry.pull, title } } : entry;
	});
}

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
		expect(numbers('limting')).toEqual([214]);
	});

	test('ignores letters scattered across a title', () => {
		const entries = retitled({ 211: 'refactor(cli): extract `sivir list` formatting, add `sivir status`' });

		expect(numbers('fix', entries)).toEqual([209]);
		expect(numbers('rxsl', entries)).toEqual([]);
		expect(numbers('stop')).toEqual([]);
	});

	test('drops loose matches once a pull request matches as typed', () => {
		expect(numbers('chrt', retitled({ 211: 'Chart rendering' }))).toEqual([211]);
		expect(numbers('chrt', retitled({ 211: 'Chart rendering', 207: 'Add the chrt alias' }))).toEqual([207]);
	});

	test('matches two letters only at the start of a word', () => {
		expect(numbers('ca')).toEqual([198]);
	});
});
