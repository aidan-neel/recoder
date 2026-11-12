import { describe, expect, test } from 'bun:test';

import {
	backwardRange,
	docFromSegments,
	docFromText,
	embedLinks,
	fitInsert,
	replaceRange,
	segmentsOf,
	snapRange,
	wordAround
} from '../../src/components/form/link-model';

const PR = 'https://github.com/acme/api/pull/214';

describe('link field content', () => {
	test('round-trips text through segments, with links at the start, the middle and the end', () => {
		const text = `${PR} and https://acme.dev/a, then ${PR}`;
		const doc = docFromText(text);

		expect(segmentsOf(doc)).toEqual([
			{ kind: 'link', url: PR },
			{ kind: 'text', text: ' and ' },
			{ kind: 'link', url: 'https://acme.dev/a' },
			{ kind: 'text', text: ', then ' },
			{ kind: 'link', url: PR }
		]);

		expect(docFromSegments(segmentsOf(doc))).toEqual(doc);
	});

	test('embeds the URL of a Markdown link and keeps the brackets as text', () => {
		expect(segmentsOf(docFromText('[docs](https://acme.dev/docs)'))).toEqual([
			{ kind: 'text', text: '[docs](' },
			{ kind: 'link', url: 'https://acme.dev/docs' },
			{ kind: 'text', text: ')' }
		]);
	});

	test('leaves the link in the word being typed as text', () => {
		const text = `see ${PR}`;

		expect(embedLinks({ text, links: [] }, wordAround(text, text.length)).links).toEqual([]);
		expect(embedLinks({ text, links: [] }, wordAround(text, 1)).links).toEqual([{ start: 4, end: text.length }]);
	});

	test('keeps text typed at an embed edge outside the embed, and moves the embeds after an edit', () => {
		const doc = docFromText(`${PR} x`);
		const before = replaceRange(doc, { start: 0, end: 0 }, 'a ');
		const after = replaceRange(doc, { start: PR.length, end: PR.length }, '!');

		expect(before.links).toEqual([{ start: 2, end: 2 + PR.length }]);
		expect(after).toEqual({ text: `${PR}! x`, links: [{ start: 0, end: PR.length }] });
	});

	test('grows a range that cuts into an embed to hold it whole', () => {
		const doc = docFromText(`a ${PR} b`);

		expect(snapRange(doc, { start: 5, end: 10 })).toEqual({ start: 2, end: 2 + PR.length });
	});

	test('removes a surrogate pair whole on Backspace', () => {
		const text = 'ok 👍';

		expect(backwardRange({ text, links: [] }, text.length)).toEqual({ start: 3, end: 5 });
	});

	test('keeps only as much of an insert as fits the length limit, never half a surrogate pair', () => {
		const doc = docFromText('abc');

		expect(fitInsert(doc, { start: 3, end: 3 }, 'defg', 5)).toBe('de');
		expect(fitInsert(doc, { start: 3, end: 3 }, 'd👍', 5)).toBe('d');
		expect(fitInsert(doc, { start: 0, end: 3 }, 'wxyz', 5)).toBe('wxyz');
	});
});
