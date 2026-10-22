import { expect, test } from 'bun:test';

import { parseLimit } from '../../src/lib/settings/limits';

test('a typed limit may carry thousands separators and spaces', () => {
	expect(parseLimit(' 60,000 ', 1_000_000)).toEqual({ value: 60_000 });
	expect(parseLimit('1 000_000', 1_000_000)).toEqual({ value: 1_000_000 });
});

test('a limit outside 1 to the cap, or not a whole number, is refused with the range', () => {
	const refused = { error: 'Enter a whole number from 1 to 200.' };

	expect(parseLimit('0', 200)).toEqual(refused);
	expect(parseLimit('201', 200)).toEqual(refused);
	expect(parseLimit('12.5', 200)).toEqual(refused);
	expect(parseLimit('', 200)).toEqual(refused);
});
