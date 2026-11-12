import { describe, expect, test } from 'bun:test';

import {
	adoptEdit,
	deferValue,
	EMPTY_COMPOSITION,
	endComposition,
	startComposition
} from '../../src/components/form/link-composition';
import { EMPTY_HISTORY, record, undo } from '../../src/components/form/link-history';
import { docFromText } from '../../src/components/form/link-model';

const ISSUE = 'https://github.com/acme/api/issues/18';

describe('link field composition', () => {
	test('keeps an external value set during composition and yields it when composition ends', () => {
		const started = startComposition(EMPTY_COMPOSITION, { doc: docFromText('draft'), caret: 5 });
		const waiting = deferValue(started, '');

		expect(deferValue(EMPTY_COMPOSITION, '')).toBeNull();
		expect(waiting).not.toBeNull();

		const finished = endComposition(waiting ?? started);

		expect(finished.state).toEqual(EMPTY_COMPOSITION);
		expect(finished.outcome).toEqual({ kind: 'pending', text: '' });
	});

	test('preserves the pre-composition caret snapshot so undo restores both text and caret', () => {
		const before = { doc: docFromText('hello '), caret: 6 };
		const active = startComposition(EMPTY_COMPOSITION, before);
		const finished = endComposition(active);

		expect(finished.outcome).toEqual({ kind: 'adopt', before });

		const saved = finished.outcome.kind === 'adopt' && finished.outcome.before ? finished.outcome.before : before;
		const history = record(EMPTY_HISTORY, saved, { kind: 'type', caret: 8, at: 100 });
		const undone = undo(history, { doc: docFromText('hello 日本'), caret: 8 });

		expect(undone?.snapshot).toEqual(before);
	});

	test('clamps composed text to maxLength while keeping untouched embeds and code points whole', () => {
		const before = docFromText(`${ISSUE} `);
		const composed = `${ISSUE} 1234567890`;
		const read = { text: composed, links: [{ start: 0, end: ISSUE.length }] };

		const clamped = adoptEdit({
			before,
			read,
			caret: composed.length,
			maxLength: ISSUE.length + 5
		});

		expect(clamped.doc.text).toBe(`${ISSUE} 1234`);
		expect(clamped.doc.links).toEqual([{ start: 0, end: ISSUE.length }]);
		expect(clamped.caret).toBe(ISSUE.length + 5);

		const emoji = adoptEdit({
			before: docFromText('ab'),
			read: { text: 'ab😀', links: [] },
			caret: 4,
			maxLength: 3
		});

		expect(emoji.doc.text).toBe('ab');
		expect(emoji.caret).toBe(2);
	});

	test('drops a caret holder the browser moved into the added text, and keeps the caret after that text', () => {
		const before = docFromText(ISSUE);
		const composed = `${ISSUE}\u200Bté`;
		const read = { text: composed, links: [{ start: 0, end: ISSUE.length }] };

		const adopted = adoptEdit({ before, read, caret: composed.length, maxLength: undefined });

		expect(adopted.doc.text).toBe(`${ISSUE}té`);
		expect(adopted.caret).toBe(ISSUE.length + 2);
	});

	test('keeps a zero-width space the browser added where no embed is near', () => {
		const before = { text: 'ab', links: [] };
		const read = { text: 'ab\u200B', links: [] };

		const adopted = adoptEdit({ before, read, caret: 3, maxLength: undefined });

		expect(adopted.doc.text).toBe('ab\u200B');
		expect(adopted.caret).toBe(3);
	});

	test('keeps a zero-width space that was in the text before the browser wrote', () => {
		const before = { text: 'a\u200Bb', links: [] };
		const read = { text: 'a\u200BbX', links: [] };

		const adopted = adoptEdit({ before, read, caret: 4, maxLength: undefined });

		expect(adopted.doc.text).toBe('a\u200BbX');
		expect(adopted.caret).toBe(4);
	});
});
