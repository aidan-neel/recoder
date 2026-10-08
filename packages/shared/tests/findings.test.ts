import { expect, test } from 'bun:test';
import { splitCategoryTag } from '../src/findings';

test('a leading category tag is split from the message body', () => {
	expect(splitCategoryTag('[security] Any caller can\n name another tenant.')).toEqual({
		tag: 'security',
		body: 'Any caller can\n name another tenant.'
	});
});

test('a message without a leading tag is all body', () => {
	expect(splitCategoryTag('Reads `[0]` of an empty list.')).toEqual({ body: 'Reads `[0]` of an empty list.' });
	expect(splitCategoryTag('')).toEqual({ body: '' });
});
