import { create } from 'zustand';

import { readStored, writeStored } from './browser-storage';

/** One window tab: every page it has shown, oldest first, and the one on screen, which its Back and Forward walk. */
export interface WindowTab {
	id: string;
	/** Addresses inside the app: a path with its search, such as `/pulls/api/214?tab=review`. */
	entries: string[];
	index: number;
}

/** The open tabs in their order, the one on screen, and the tabs closed most recently, newest last. */
export interface TabsState {
	tabs: WindowTab[];
	activeId: string;
	closed: WindowTab[];
}

/** Where a browser history entry was made: the tab and the step of its history it showed. */
export interface TabMark {
	tab: string;
	index: number;
}

/** How far back one tab remembers; the oldest pages fall off first. */
const MAX_ENTRIES = 50;

/** How many closed tabs can come back. */
const MAX_CLOSED = 20;

/** A short id for a new tab, unique among the tabs of one browser. */
function newTabId(): string {
	return Math.random().toString(36).slice(2, 10);
}

/** The page a tab shows. */
export function currentHref(tab: WindowTab): string {
	return tab.entries[tab.index];
}

/** An address without its search or hash: two addresses with the same path are the same page. */
export function pathOf(href: string): string {
	return href.split(/[?#]/)[0];
}

/** The tab on screen. */
export function activeTab(state: TabsState): WindowTab {
	return state.tabs.find((tab) => tab.id === state.activeId) ?? state.tabs[0];
}

/** `state` with one tab changed. */
function withTab(state: TabsState, id: string, change: (tab: WindowTab) => WindowTab): TabsState {
	return { ...state, tabs: state.tabs.map((tab) => (tab.id === id ? change(tab) : tab)) };
}

/** A tab that has gone on to `href`: what was ahead of it is dropped, and the oldest pages past the limit fall off. */
function pushed(tab: WindowTab, href: string): WindowTab {
	const entries = [...tab.entries.slice(0, tab.index + 1), href].slice(-MAX_ENTRIES);

	return { ...tab, entries, index: entries.length - 1 };
}

/** The tab on screen goes on to `href`, keeping where it was for Back. */
export function visit(state: TabsState, href: string): TabsState {
	const tab = activeTab(state);

	return currentHref(tab) === href ? state : withTab(state, tab.id, (current) => pushed(current, href));
}

/** The tab on screen shows `href` in place of its page, such as another tab of the same pull request. */
export function swap(state: TabsState, href: string): TabsState {
	return withTab(state, activeTab(state).id, (tab) => ({
		...tab,
		entries: tab.entries.map((entry, index) => (index === tab.index ? href : entry))
	}));
}

/** Brings a tab to the screen. */
export function activate(state: TabsState, id: string): TabsState {
	return state.tabs.some((tab) => tab.id === id) ? { ...state, activeId: id } : state;
}

/** Another tab, other than the one on screen, already showing the page `href` names; null when none does. */
export function tabShowing(state: TabsState, href: string): WindowTab | null {
	const path = pathOf(href);

	return state.tabs.find((tab) => tab.id !== state.activeId && pathOf(currentHref(tab)) === path) ?? null;
}

/** A new tab on `href` at the end of the row, on screen. */
export function open(state: TabsState, href: string, id = newTabId()): TabsState {
	return { ...state, tabs: [...state.tabs, { id, entries: [href], index: 0 }], activeId: id };
}

/** The tab on screen steps `delta` pages back (negative) or forward through its own history. */
export function step(state: TabsState, delta: number): TabsState {
	const tab = activeTab(state);
	const index = Math.min(tab.entries.length - 1, Math.max(0, tab.index + delta));

	return index === tab.index ? state : withTab(state, tab.id, (current) => ({ ...current, index }));
}

/**
 * Closes tabs, keeping them for Reopen. The tab on screen gives way to the next one along, or the one before it at the
 * end of the row; closing every tab leaves one new tab on `fallback`, as a window never goes empty.
 */
export function close(state: TabsState, ids: readonly string[], fallback: string): TabsState {
	const gone = state.tabs.filter((tab) => ids.includes(tab.id));

	if (gone.length === 0) return state;

	const tabs = state.tabs.filter((tab) => !ids.includes(tab.id));
	const closed = [...state.closed, ...gone].slice(-MAX_CLOSED);

	if (tabs.length === 0) return open({ ...state, tabs, closed }, fallback);
	if (!ids.includes(state.activeId)) return { ...state, tabs, closed };

	const from = state.tabs.findIndex((tab) => tab.id === state.activeId);
	const next = state.tabs.slice(from + 1).find((tab) => !ids.includes(tab.id)) ?? tabs[tabs.length - 1];

	return { tabs, closed, activeId: next.id };
}

/** Brings back the tab closed last, with its history, at the end of the row. */
export function reopen(state: TabsState): TabsState {
	const tab = state.closed[state.closed.length - 1];

	if (!tab) return state;

	return { tabs: [...state.tabs, tab], closed: state.closed.slice(0, -1), activeId: tab.id };
}

/** Puts the tabs in the order of `ids`, as a drag leaves them. */
export function reorder(state: TabsState, ids: readonly string[]): TabsState {
	const tabs = ids.map((id) => state.tabs.find((tab) => tab.id === id)).filter((tab) => tab !== undefined);

	return tabs.length === state.tabs.length ? { ...state, tabs } : state;
}

/**
 * The tabs after the browser's own Back or Forward lands on `href`. An entry the app made names its tab and step,
 * which come back to the screen. Any other lands in the tab already showing that page, or else in the tab on screen.
 */
export function follow(state: TabsState, href: string, mark: TabMark | null): TabsState {
	const marked = mark ? state.tabs.find((tab) => tab.id === mark.tab) : undefined;

	if (marked && mark && marked.entries[mark.index] === href)
		return withTab({ ...state, activeId: marked.id }, marked.id, (tab) => ({ ...tab, index: mark.index }));

	if (currentHref(activeTab(state)) === href) return state;

	const showing = tabShowing(state, href);

	return swap(showing ? activate(state, showing.id) : state, href);
}

/**
 * The tabs a visit starts with: those kept in this browser, with the address the window opened on. A reload finds its
 * page on screen; an address another tab shows brings that tab forward; any other opens in a new tab, so a link from
 * outside never takes over a tab in use.
 */
export function arrive(kept: TabsState | null, href: string): TabsState {
	if (!kept || kept.tabs.length === 0) return open({ tabs: [], activeId: '', closed: kept?.closed ?? [] }, href);
	if (currentHref(activeTab(kept)) === href) return { ...kept, activeId: activeTab(kept).id };

	const showing = tabShowing(kept, href);

	return showing ? swap(activate(kept, showing.id), href) : open(kept, href);
}

/** True for a value that has the shape of a tab. */
function isTab(value: unknown): value is WindowTab {
	const tab = value as WindowTab;

	return (
		typeof tab === 'object' &&
		tab !== null &&
		typeof tab.id === 'string' &&
		Array.isArray(tab.entries) &&
		tab.entries.length > 0 &&
		tab.entries.every((entry) => typeof entry === 'string' && entry.startsWith('/')) &&
		Number.isInteger(tab.index) &&
		tab.index >= 0 &&
		tab.index < tab.entries.length
	);
}

/** Kept tabs read back; null for nothing kept or anything that is not tabs, so a bad value never breaks the window. */
export function parseTabs(text: string | null): TabsState | null {
	if (!text) return null;

	try {
		const value = JSON.parse(text) as Partial<TabsState>;
		const tabs = Array.isArray(value.tabs) ? value.tabs.filter(isTab) : [];
		const closed = Array.isArray(value.closed) ? value.closed.filter(isTab) : [];
		const activeId = typeof value.activeId === 'string' ? value.activeId : '';

		return { tabs, closed, activeId };
	} catch {
		return null;
	}
}

/** Where this browser keeps the tabs; the sample keeps its own, apart from the live app's. */
function storageKey(scope: string): string {
	return `recoder.tabs.v1.${scope}`;
}

/** The window's tabs. Empty until `startTabs` reads the kept ones against the address the window opened on. */
export const useTabs = create<TabsState>(() => ({ tabs: [], activeId: '', closed: [] }));

/** The scope the tabs were started for, or null before they start. */
let startedScope: string | null = null;

/** Reads the kept tabs once per visit and keeps every change after. With storage blocked they hold for the visit. */
export function startTabs(scope: string, href: string): void {
	if (startedScope !== null) return;

	startedScope = scope;
	useTabs.setState(arrive(parseTabs(readStored(storageKey(scope))), href), true);
	useTabs.subscribe((state) => writeStored(storageKey(scope), JSON.stringify(state)));
}
