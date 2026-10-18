import { describe, expect, test } from 'bun:test';

import { fitTabs, neighborAfterClose, type TabFitInput } from '../../src/lib/shell/tab-fit';

/** Five 100px tabs, a 60px Queue tab, a 70px More trigger and a 240px or 170px search. */
function input(room: number, active: string | null): TabFitInput {
	return {
		room,
		fixed: 60,
		tabs: ['a', 'b', 'c', 'd', 'e'].map((id) => ({ id, width: 100 })),
		more: 70,
		search: { wide: 240, narrow: 170 },
		active
	};
}

describe('fitTabs', () => {
	test('keeps the active tab in the bar by moving trailing tabs before it into More', () => {
		const fit = fitTabs(input(580, 'e'));

		expect(fit.visible).toEqual(['a', 'e']);
		expect(fit.hidden).toEqual(['b', 'c', 'd']);
	});

	test('shrinks the search only when that keeps one more tab in the bar', () => {
		expect(fitTabs(input(580, null)).compact).toBe(false);
		expect(fitTabs(input(700, null))).toEqual({ visible: ['a', 'b', 'c', 'd'], hidden: ['e'], compact: true });
	});
});

describe('neighborAfterClose', () => {
	test('moves right past the closing tabs, then left, then to the queue', () => {
		const ids = ['a', 'b', 'c', 'd'];

		expect(neighborAfterClose(ids, ['b', 'c'], 'b')).toBe('d');
		expect(neighborAfterClose(ids, ['c', 'd'], 'd')).toBe('b');
		expect(neighborAfterClose(ids, ids, 'b')).toBeNull();
	});
});
