'use client';

import { useMemo, useSyncExternalStore } from 'react';

import { SAMPLE_HREF } from './routes';
import {
	activate,
	activeTab,
	close,
	currentHref,
	duplicate,
	follow,
	open,
	reopen,
	reorder,
	startTabs,
	step,
	swap,
	tabShowing,
	useTabs,
	visit,
	type TabMark,
	type TabsState
} from './tabs';

/**
 * Where the app is, read from the browser's own address. The app renders in
 * the browser only, so a page change is a history entry and a render: no
 * request to the server that serves the app, in development or production.
 * Next patches the history calls and keeps its own router on the same
 * address, so back, forward and a reload behave as on any page.
 *
 * The address is the page of the window tab on screen (`tabs.ts`). Every move
 * goes through a tab first, then writes the address, marking the history entry
 * with the tab and step it shows, so the browser's own Back and Forward bring
 * that tab and step back.
 */

const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
	listeners.add(listener);
	window.addEventListener('popstate', listener);

	return () => {
		listeners.delete(listener);
		window.removeEventListener('popstate', listener);
	};
}

/** Tells every reader the address changed; the history calls fire no event of their own. */
function announce(): void {
	for (const listener of [...listeners]) listener();
}

/** True for a path of the sample, which has its own shell and client. */
function inSample(pathname: string): boolean {
	return pathname === SAMPLE_HREF || pathname.startsWith(`${SAMPLE_HREF}/`);
}

/** The address on screen as a tab keeps it: the path and its search. */
function here(): string {
	return `${window.location.pathname}${window.location.search}`;
}

/** An address inside the app as a tab keeps it. */
function addressOf(href: string): string {
	const target = new URL(href, window.location.href);

	return `${target.pathname}${target.search}`;
}

/**
 * True for an address the shell on screen cannot show: another site, or the
 * other side of the line between the live app and the sample. The browser
 * loads those.
 */
export function leavesApp(href: string): boolean {
	const target = new URL(href, window.location.href);

	return target.origin !== window.location.origin || inSample(target.pathname) !== inSample(window.location.pathname);
}

/**
 * Applies a change to the tabs and shows the page of the tab on screen: a new history entry for a move, the same one
 * for a swap, so the browser's Back undoes moves and skips swaps.
 */
function show(change: (state: TabsState) => TabsState, entry: 'push' | 'replace'): void {
	startWindowTabs();
	useTabs.setState(change(useTabs.getState()), true);

	const tab = activeTab(useTabs.getState());
	const mark: TabMark = { tab: tab.id, index: tab.index };
	const href = currentHref(tab);

	if (entry === 'push' && href !== here()) window.history.pushState(mark, '', href);
	else window.history.replaceState(mark, '', href);

	announce();
}

/**
 * Starts the window's tabs from the ones kept in this browser and the address the window opened on. Runs once per
 * visit, before the topbar first renders; the sample keeps tabs of its own.
 */
export function startWindowTabs(): void {
	if (useTabs.getState().tabs.length === 0) startTabs(inSample(window.location.pathname) ? 'sample' : 'live', here());
}

/**
 * Marks the history entry the window opened on with its tab, so the browser's Back to it finds that tab. Runs after
 * the first render: Next's router follows the history calls, and must not change while the shell renders.
 */
export function markOpeningEntry(): void {
	const tab = activeTab(useTabs.getState());

	window.history.replaceState({ tab: tab.id, index: tab.index } satisfies TabMark, '', currentHref(tab));
}

/** The browser's own Back and Forward: the tab and step the entry was made in come back. */
function followBrowser(event: PopStateEvent): void {
	if (useTabs.getState().tabs.length === 0) return;

	const mark = event.state as Partial<TabMark> | null;
	const known = typeof mark?.tab === 'string' && typeof mark.index === 'number' ? (mark as TabMark) : null;

	useTabs.setState(follow(useTabs.getState(), here(), known), true);
}

if (typeof window !== 'undefined') window.addEventListener('popstate', followBrowser);

/**
 * Goes to a page in the tab on screen, and Back returns here. A page another tab already shows brings that tab
 * forward instead, so one page is never open twice.
 */
export function navigate(href: string): void {
	if (leavesApp(href)) {
		window.location.assign(href);

		return;
	}

	const address = addressOf(href);

	if (address === here()) return;

	const showing = tabShowing(useTabs.getState(), address);

	show((state) => (showing ? swap(activate(state, showing.id), address) : visit(state, address)), 'push');
}

/** Swaps the address in place, such as for another tab or a redirect: Back skips the one it replaced. */
export function replaceAddress(href: string): void {
	if (leavesApp(href)) {
		window.location.replace(href);

		return;
	}

	show((state) => swap(state, addressOf(href)), 'replace');
}

/** Opens a page in a new tab at the end of the row and brings it to the screen. */
export function openTab(href: string): void {
	if (leavesApp(href)) {
		window.open(href, '_blank', 'noopener');

		return;
	}

	show((state) => open(state, addressOf(href)), 'push');
}

/** Brings a tab to the screen. */
export function switchTab(id: string): void {
	if (id !== useTabs.getState().activeId) show((state) => activate(state, id), 'push');
}

/** Closes tabs; closing the last leaves one new tab on `fallback`. */
export function closeTabs(ids: readonly string[], fallback: string): void {
	show((state) => close(state, ids, addressOf(fallback)), 'push');
}

/** Opens a copy of a tab, with its history, right after it. */
export function duplicateTab(id: string): void {
	show((state) => duplicate(state, id), 'push');
}

/** Brings back the tab closed last. */
export function reopenTab(): void {
	if (useTabs.getState().closed.length > 0) show(reopen, 'push');
}

/** Steps the tab on screen through its own history: -1 for Back, 1 for Forward. */
export function stepTab(delta: number): void {
	show((state) => step(state, delta), 'push');
}

/**
 * Steps the tab on screen back to the newest page before this one that `fits`, such as the page Settings opened over.
 * False when no page back there fits.
 */
export function stepBackTo(fits: (href: string) => boolean): boolean {
	const tab = activeTab(useTabs.getState());
	const index = tab.entries.slice(0, tab.index).findLastIndex(fits);

	if (index < 0) return false;

	stepTab(index - tab.index);

	return true;
}

/** Puts the tabs in a new order; the page on screen stays. */
export function reorderTabs(ids: readonly string[]): void {
	useTabs.setState(reorder(useTabs.getState(), ids), true);
}

/** The path of the address on screen. */
export function usePathname(): string {
	return useSyncExternalStore(
		subscribe,
		() => window.location.pathname,
		() => '/'
	);
}

/** The search params of the address on screen. */
export function useSearchParams(): URLSearchParams {
	const search = useSyncExternalStore(
		subscribe,
		() => window.location.search,
		() => ''
	);

	return useMemo(() => new URLSearchParams(search), [search]);
}
