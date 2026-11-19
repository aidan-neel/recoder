import { describe, expect, test } from 'bun:test';

import {
	arrive,
	close,
	currentHref,
	follow,
	open,
	parseTabs,
	reopen,
	step,
	visit,
	type TabsState
} from '../../src/lib/shell/tabs';

/** Two tabs: `a` on the pull request list then a pull request, `b` on Repositories, with `a` on screen. */
function twoTabs(): TabsState {
	return {
		tabs: [
			{ id: 'a', entries: ['/', '/pulls/api/214'], index: 1 },
			{ id: 'b', entries: ['/repos'], index: 0 }
		],
		activeId: 'a',
		closed: []
	};
}

describe('tab history', () => {
	test('a visit after going back drops the pages that were ahead', () => {
		const state = visit(step(twoTabs(), -1), '/new');

		expect(state.tabs[0]).toEqual({ id: 'a', entries: ['/', '/new'], index: 1 });
	});

	test('Back and Forward stop at either end of the tab', () => {
		expect(step(twoTabs(), 1)).toEqual(twoTabs());
		expect(step(step(twoTabs(), -5), 0).tabs[0].index).toBe(0);
	});
});

describe('close', () => {
	test('closing the tab on screen brings the next one along, or the one before at the end', () => {
		expect(close(twoTabs(), ['a'], '/').activeId).toBe('b');
		expect(close({ ...twoTabs(), activeId: 'b' }, ['b'], '/').activeId).toBe('a');
	});

	test('closing every tab leaves one new tab on the fallback', () => {
		const state = close(twoTabs(), ['a', 'b'], '/');

		expect(state.tabs.map(currentHref)).toEqual(['/']);
		expect(state.closed.map((tab) => tab.id)).toEqual(['a', 'b']);
	});

	test('a reopened tab comes back with its history, on screen', () => {
		const state = reopen(close(twoTabs(), ['a'], '/'));

		expect(state.activeId).toBe('a');
		expect(state.tabs.at(-1)).toEqual({ id: 'a', entries: ['/', '/pulls/api/214'], index: 1 });
	});
});

describe('follow', () => {
	test("the browser's Back to an entry the app marked brings back that tab and step", () => {
		const state = follow({ ...twoTabs(), activeId: 'b' }, '/', { tab: 'a', index: 0 });

		expect(state.activeId).toBe('a');
		expect(state.tabs[0].index).toBe(0);
	});

	test('an unmarked address another tab shows brings that tab forward', () => {
		expect(follow(twoTabs(), '/repos', null).activeId).toBe('b');
	});

	test('a mark whose page has since changed is not trusted', () => {
		const state = follow(twoTabs(), '/automations', { tab: 'b', index: 0 });

		expect(state.activeId).toBe('a');
		expect(currentHref(state.tabs[0])).toBe('/automations');
	});
});

describe('arrive', () => {
	test('a reload keeps the tabs and the one on screen', () => {
		expect(arrive(twoTabs(), '/pulls/api/214')).toEqual(twoTabs());
	});

	test('an address another tab shows brings that tab forward, with its search', () => {
		const state = arrive(twoTabs(), '/repos?scope=attention');

		expect(state.activeId).toBe('b');
		expect(currentHref(state.tabs[1])).toBe('/repos?scope=attention');
	});

	test('any other address opens in a new tab instead of taking over one in use', () => {
		const state = arrive(twoTabs(), '/chats/c1');

		expect(state.tabs).toHaveLength(3);
		expect(currentHref(state.tabs[2])).toBe('/chats/c1');
		expect(state.activeId).toBe(state.tabs[2].id);
	});

	test('a first visit starts with one tab on the address', () => {
		expect(arrive(null, '/new').tabs.map(currentHref)).toEqual(['/new']);
	});
});

describe('parseTabs', () => {
	test('drops kept tabs that are not tabs, and reads nothing from text that is not JSON', () => {
		const kept = JSON.stringify({
			tabs: [
				{ id: 'a', entries: ['/'], index: 0 },
				{ id: 'b', entries: [], index: 0 },
				{ id: 'c', entries: ['https://elsewhere.test/'], index: 0 },
				{ id: 'd', entries: ['/repos'], index: 3 }
			],
			activeId: 'a',
			closed: 'nope'
		});

		expect(parseTabs(kept)).toEqual({ tabs: [{ id: 'a', entries: ['/'], index: 0 }], activeId: 'a', closed: [] });
		expect(parseTabs('{')).toBeNull();
	});

	test('a kept tab survives the round trip', () => {
		const state = open(twoTabs(), '/new', 'c');

		expect(parseTabs(JSON.stringify(state))).toEqual(state);
	});
});
