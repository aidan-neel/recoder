import { describe, expect, test } from 'bun:test';

import { arrivalAt, revealStep } from '../../src/components/content/stream-pace';

/** What `revealStep` shows of `text` from nothing with an unlimited budget. */
function shownOf(text: string, done = false): string {
	return text.slice(0, revealStep(text, 0, Number.POSITIVE_INFINITY, done).length);
}

describe('revealStep', () => {
	test('holds back the last word until text after it or the end of the stream proves it whole', () => {
		expect(shownOf('A bucket gro')).toBe('A bucket ');
		expect(shownOf('A bucket gro', true)).toBe('A bucket gro');
	});

	test('holds a code span at its opening backtick until its closing one arrives', () => {
		expect(shownOf('because `elapsed × refill')).toBe('because ');
		expect(shownOf('because `elapsed × refill` never ')).toBe('because `elapsed × refill` never ');
	});

	test('holds a link at its bracket until its target closes', () => {
		expect(shownOf('as it is [rate limit setup](#cite:src/a.ts:6')).toBe('as it is ');

		expect(shownOf('as it is [rate limit setup](#cite:src/a.ts:6). Then ')).toBe(
			'as it is [rate limit setup](#cite:src/a.ts:6). Then '
		);
	});

	test('shows code inside a fence as it arrives', () => {
		expect(shownOf('```ts\nconst a = `b')).toBe('```ts\nconst a = ');
	});

	test('lets out no more words than the budget pays for, and at least one once it does', () => {
		expect(revealStep('one two three ', 0, 5, false)).toEqual({ length: 4, budget: 1 });
		expect(revealStep('one two three ', 0, 3, false)).toEqual({ length: 0, budget: 3 });
	});

	test('drops the budget while it waits on text still to come, so a pause never releases a burst', () => {
		expect(revealStep('one tw', 4, 500, false)).toEqual({ length: 4, budget: 0 });
	});
});

describe('arrivalAt', () => {
	test('times a character by the first step that showed it, and anything past the end by the latest', () => {
		const arrivals = [
			{ end: 4, at: 100 },
			{ end: 8, at: 200 }
		];

		expect(arrivalAt(arrivals, 0)).toBe(100);
		expect(arrivalAt(arrivals, 4)).toBe(200);
		expect(arrivalAt(arrivals, 99)).toBe(200);
	});
});
