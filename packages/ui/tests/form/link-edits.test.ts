import { describe, expect, test } from 'bun:test';

import {
	deletionRange,
	extendOver,
	pasteText,
	snapSelection,
	stepOver,
	typeText
} from '../../src/components/form/link-edits';
import { docFromText, type LinkDoc } from '../../src/components/form/link-model';

const PR = 'https://github.com/acme/api/pull/214';

/** Types text one character at a time at the end, the way a person does. */
function typeAll(doc: LinkDoc, text: string): LinkDoc {
	let current = doc;

	for (const char of text) {
		const end = current.text.length;

		current = typeText(current, { start: end, end }, char, undefined)?.doc ?? current;
	}

	return current;
}

describe('link field edits', () => {
	test('keeps a URL text while it is typed, then embeds it when a space ends it', () => {
		const typing = typeAll(docFromText(''), `see ${PR}`);
		const ended = typeText(typing, { start: typing.text.length, end: typing.text.length }, ' ', undefined);

		expect(typing.links).toEqual([]);
		expect(ended?.embedded).toBe(true);
		expect(ended?.doc.links).toEqual([{ start: 4, end: 4 + PR.length }]);
	});

	test('embeds every link in a paste, cleans line ends and keeps trailing punctuation as text', () => {
		const pasted = pasteText(docFromText(''), { start: 0, end: 0 }, `a ${PR}.\r\nhttps://acme.dev/x`, undefined);

		expect(pasted.doc.text).toBe(`a ${PR}.\nhttps://acme.dev/x`);
		expect(pasted.doc.links).toHaveLength(2);
		expect(pasted.caret).toBe(pasted.doc.text.length);
	});

	test('replaces everything when the whole text is selected', () => {
		const doc = docFromText(`${PR} more`);
		const typed = typeText(doc, { start: 0, end: doc.text.length }, 'x', undefined);

		expect(typed?.doc).toEqual({ text: 'x', links: [] });
	});

	test('cuts a paste to the length limit', () => {
		const pasted = pasteText(docFromText('ab'), { start: 2, end: 2 }, 'cdef', 4);

		expect(pasted.doc.text).toBe('abcd');
	});

	test('takes the embed beside the caret whole on Backspace and on Delete', () => {
		const doc = docFromText(`a ${PR} b`);
		const end = 2 + PR.length;

		expect(deletionRange(doc, 'backward', { start: end, end }, { start: end - 1, end })).toEqual({ start: 2, end });
		expect(deletionRange(doc, 'forward', { start: 2, end: 2 }, { start: 2, end: 3 })).toEqual({ start: 2, end });
	});

	test('grows a word deletion that reaches into an embed to take it whole', () => {
		const doc = docFromText(`a ${PR} b`);

		expect(
			deletionRange(doc, 'range', { start: 2 + PR.length, end: 2 + PR.length }, { start: 30, end: 2 + PR.length })
		).toEqual({
			start: 2,
			end: 2 + PR.length
		});
	});

	test('moves a caret inside an embed to its nearer edge, and keeps a backward selection backward', () => {
		const doc = docFromText(`a ${PR} b`);

		expect(snapSelection(doc, { anchor: 4, focus: 4 })).toEqual({ anchor: 2, focus: 2 });
		expect(snapSelection(doc, { anchor: 35, focus: 35 })).toEqual({ anchor: 2 + PR.length, focus: 2 + PR.length });
		expect(snapSelection(doc, { anchor: 40, focus: 5 })).toEqual({ anchor: 40, focus: 2 });
	});

	test('steps the caret over an embed, and extends a selection over it whole', () => {
		const doc = docFromText(`a ${PR} b`);
		const end = 2 + PR.length;

		expect(stepOver(doc, { anchor: 2, focus: 2 }, 1)).toEqual({ anchor: end, focus: end });
		expect(stepOver(doc, { anchor: end, focus: end }, -1)).toEqual({ anchor: 2, focus: 2 });
		expect(stepOver(doc, { anchor: 0, focus: 0 }, 1)).toBeNull();
		expect(extendOver(doc, { anchor: end + 2, focus: end }, -1)).toEqual({ anchor: end + 2, focus: 2 });
	});
});
