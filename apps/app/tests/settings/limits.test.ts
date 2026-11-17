import { expect, test } from 'bun:test';

import { parseLimit, stepLimit } from '../../src/lib/settings/limits';

test('a typed limit may carry thousands separators and spaces', () => {
	expect(parseLimit(' 60,000 ', 1_000_000)).toEqual({ value: 60_000 });
	expect(parseLimit('1 000_000', 1_000_000)).toEqual({ value: 1_000_000 });
});

test('a subagent count may be 0 and may not exceed 99', () => {
	expect(parseLimit('0', 99, 0)).toEqual({ value: 0 });
	expect(parseLimit('99', 99, 0)).toEqual({ value: 99 });
	expect(parseLimit('100', 99, 0)).toEqual({ error: 'Enter a whole number from 0 to 99.' });
});

test('a limit outside 1 to the cap, or not a whole number, is refused with the range', () => {
	const refused = { error: 'Enter a whole number from 1 to 200.' };

	expect(parseLimit('0', 200)).toEqual(refused);
	expect(parseLimit('201', 200)).toEqual(refused);
	expect(parseLimit('12.5', 200)).toEqual(refused);
	expect(parseLimit('', 200)).toEqual(refused);
});

test('stepping snaps to multiples of the step and clamps to the bounds', () => {
	expect(stepLimit(200, -1, 10, 200)).toBe(190);
	expect(stepLimit(10, -1, 10, 200)).toBe(1);
	expect(stepLimit(1, 1, 10, 200)).toBe(10);
	expect(stepLimit(25, 1, 10, 200)).toBe(30);
	expect(stepLimit(25, -1, 10, 200)).toBe(20);
	expect(stepLimit(999, -1, 10, 200)).toBe(200);
	expect(stepLimit(0, 1, 10, 200)).toBe(1);
});
