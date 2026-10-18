import { describe, expect, test } from 'bun:test';

import { decide, revert, stateOf, withNote } from '../../src/lib/review/decisions';

describe('decisions', () => {
	test('undo returns an item to open, and a redecided item to its earlier state with its note', () => {
		const first = decide({}, 'f1', 'sent', 1);

		expect(first).not.toBeNull();

		const noted = withNote(first!.records, 'f1', 'use the client address');
		const second = decide(noted, 'f1', 'accepted', 2);

		expect(second!.records.f1).toEqual({ state: 'accepted', note: 'use the client address', at: 2 });

		expect(revert(second!.records, second!.change).f1).toEqual({
			state: 'sent',
			note: 'use the client address',
			at: 1
		});

		expect(stateOf(revert(first!.records, first!.change), 'f1')).toBe('open');
	});

	test('deciding an item into the state it already has records no change', () => {
		const first = decide({}, 'f1', 'accepted', 1);

		expect(decide(first!.records, 'f1', 'accepted', 2)).toBeNull();
	});

	test('a note on an open item never decides it', () => {
		expect(withNote({}, 'f1', 'note')).toEqual({});
	});

	test('opening a sent item again keeps its note, so sending it back again brings the note back', () => {
		const sent = withNote(decide({}, 'f1', 'sent', 1)!.records, 'f1', 'key clients by IP');
		const reopened = decide(sent, 'f1', 'open', 2)!.records;

		expect(stateOf(reopened, 'f1')).toBe('open');
		expect(decide(reopened, 'f1', 'sent', 3)!.records.f1).toEqual({ state: 'sent', note: 'key clients by IP', at: 3 });
	});
});
