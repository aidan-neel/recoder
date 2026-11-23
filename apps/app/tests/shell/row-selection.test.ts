import { describe, expect, test } from 'bun:test';

import { extend, pick, type RowSelection } from '../../src/lib/shell/row-selection';

const ORDER = ['a', 'b', 'c', 'd', 'e'];
const NONE: RowSelection = { ids: [], anchor: null };

describe('picking sidebar rows', () => {
	test('a Shift-click selects from the row last opened, in either direction', () => {
		const opened = pick(NONE, ORDER, 'd', 'open');

		expect(pick(opened, ORDER, 'b', 'range')).toEqual({ ids: ['b', 'c', 'd'], anchor: 'd' });
		expect(pick(opened, ORDER, 'e', 'range')).toEqual({ ids: ['d', 'e'], anchor: 'd' });
	});

	test('a second Shift-click moves the range end and keeps the anchor', () => {
		const first = pick({ ids: [], anchor: 'b' }, ORDER, 'e', 'range');

		expect(pick(first, ORDER, 'c', 'range')).toEqual({ ids: ['b', 'c'], anchor: 'b' });
	});

	test('a Cmd-click adds or drops one row and keeps list order', () => {
		const added = pick({ ids: ['d'], anchor: 'd' }, ORDER, 'a', 'toggle');

		expect(added).toEqual({ ids: ['a', 'd'], anchor: 'a' });
		expect(pick(added, ORDER, 'd', 'toggle')).toEqual({ ids: ['a'], anchor: 'd' });
	});

	test('a range from an anchor that left the list starts at the clicked row', () => {
		expect(pick({ ids: [], anchor: 'gone' }, ORDER, 'c', 'range')).toEqual({ ids: ['c'], anchor: 'c' });
	});

	test('Shift+arrow grows and shrinks the range around the anchor and stops at the ends', () => {
		const down = extend(NONE, ORDER, 'b', 1);

		expect(down).toEqual({ selection: { ids: ['b', 'c'], anchor: 'b' }, focus: 'c' });
		expect(extend(down!.selection, ORDER, 'c', -1)).toEqual({ selection: { ids: ['b'], anchor: 'b' }, focus: 'b' });
		expect(extend(NONE, ORDER, 'e', 1)).toBeNull();
	});
});
