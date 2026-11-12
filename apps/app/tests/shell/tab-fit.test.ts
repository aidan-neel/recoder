import { describe, expect, test } from 'bun:test';

import { fitTabs, neighborAfterClose, type TabFitInput } from '../../src/lib/shell/tab-fit';

/** Five 100px tabs, a 60px Queue tab, a 70px More trigger and a 240px, 170px or 30px search. */
function input(room: number, active: string | null): TabFitInput {
	return {
		room,
		fixed: 60,
		tabs: ['a', 'b', 'c', 'd', 'e'].map((id) => ({ id, width: 100 })),
		more: 70,
		search: { wide: 240, narrow: 170, icon: 30 },
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
		expect(fitTabs(input(580, null)).search).toBe('wide');
		expect(fitTabs(input(700, null))).toEqual({ visible: ['a', 'b', 'c', 'd'], hidden: ['e'], search: 'narrow' });
	});

	test('puts the active tab in More instead of clipping it when the bar is too narrow for it', () => {
		expect(fitTabs(input(250, 'c'))).toEqual({ visible: [], hidden: ['a', 'b', 'c', 'd', 'e'], search: 'icon' });
	});

	test('shrinks the search to its icon when only that keeps the active tab in the bar', () => {
		expect(fitTabs(input(390, 'c'))).toEqual({ visible: ['a', 'c'], hidden: ['b', 'd', 'e'], search: 'icon' });
	});

	test('shrinks the search when that is what keeps the active tab in the bar', () => {
		expect(fitTabs(input(400, 'c'))).toEqual({ visible: ['c'], hidden: ['a', 'b', 'd', 'e'], search: 'narrow' });
	});

	test('shows the search as its icon when Queue and More do not fit beside the shrunk one', () => {
		expect(fitTabs(input(280, 'c'))).toEqual({ visible: ['c'], hidden: ['a', 'b', 'd', 'e'], search: 'icon' });
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
