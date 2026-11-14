import { describe, expect, test } from 'bun:test';

import { imageToken, keepImageTokens, withoutImageTokens } from '../../src/components/form/link-image';
import { backwardRange, docFromText, replaceRange, segmentsOf } from '../../src/components/form/link-model';

const URL = 'https://acme.dev/a';
const FIRST = imageToken('3f2a-01');
const SECOND = imageToken('9c1b-02');

describe('image tokens in a link field', () => {
	test('a token is an embed of its own, and a link right before it stops at its mark', () => {
		const doc = docFromText(`see ${URL}${FIRST} now`);

		expect(segmentsOf(doc)).toEqual([
			{ kind: 'text', text: 'see ' },
			{ kind: 'link', url: URL },
			{ kind: 'link', url: FIRST },
			{ kind: 'text', text: ' now' }
		]);
	});

	test('Backspace right after a chip takes its whole token', () => {
		const doc = docFromText(`look ${FIRST}`);
		const range = backwardRange(doc, doc.text.length);

		expect(replaceRange(doc, range, '').text).toBe('look ');
	});

	test('the words carry no token, and only the tokens of kept images stay', () => {
		const text = `a ${FIRST} b ${SECOND} c`;

		expect(withoutImageTokens(text)).toBe('a  b  c');
		expect(keepImageTokens(text, new Set(['9c1b-02']))).toBe(`a  b ${SECOND} c`);
	});
});
