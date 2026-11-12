import { describe, expect, test } from 'bun:test';

import { EMPTY_HISTORY, record, redo, undo, type Snapshot } from '../../src/components/form/link-history';

/** A snapshot of plain text with no embeds and the caret at its end. */
function at(text: string): Snapshot {
	return { doc: { text, links: [] }, caret: text.length };
}

describe('link field history', () => {
	test('groups a run of typing within a second into one undo step', () => {
		const first = record(EMPTY_HISTORY, at(''), { kind: 'type', caret: 1, at: 0 });
		const typed = record(first, at('a'), { kind: 'type', caret: 2, at: 300 });

		expect(typed.past).toEqual([at('')]);
	});

	test('starts a new step after a pause, a change of kind or a moved caret', () => {
		const first = record(EMPTY_HISTORY, at(''), { kind: 'type', caret: 1, at: 0 });

		expect(record(first, at('a'), { kind: 'type', caret: 2, at: 1500 }).past).toHaveLength(2);
		expect(record(first, at('a'), { kind: 'delete', caret: 0, at: 100 }).past).toHaveLength(2);
		expect(record(first, { ...at('a'), caret: 0 }, { kind: 'type', caret: 1, at: 100 }).past).toHaveLength(2);
	});

	test('never groups a paste or a link becoming an embed', () => {
		const first = record(EMPTY_HISTORY, at(''), { kind: 'other', caret: 1, at: 0 });

		expect(record(first, at('a'), { kind: 'other', caret: 2, at: 100 }).past).toHaveLength(2);
	});

	test('undo then redo comes back to the same state, and a new edit drops the redo stack', () => {
		const history = record(EMPTY_HISTORY, at('a'), { kind: 'other', caret: 2, at: 0 });
		const back = undo(history, at('ab'));

		expect(back?.snapshot).toEqual(at('a'));

		const forward = back ? redo(back.history, back.snapshot) : null;

		expect(forward?.snapshot).toEqual(at('ab'));
		expect(back ? record(back.history, at('a'), { kind: 'type', caret: 2, at: 0 }).future : null).toEqual([]);
	});

	test('has nothing to undo or redo when empty', () => {
		expect(undo(EMPTY_HISTORY, at(''))).toBeNull();
		expect(redo(EMPTY_HISTORY, at(''))).toBeNull();
	});
});
