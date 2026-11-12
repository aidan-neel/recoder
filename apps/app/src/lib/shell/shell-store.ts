import { within } from '@recoder/shared';
import type { ComponentType } from 'react';
import { create } from 'zustand';

import { cachedReview } from '../review/review-cache';
import { readReview } from '../review/review-read';
import { isSampleReview, onSettings, reviewHref, reviewId } from './routes';
import { readTabs, saveTabs, TABS_KEY } from './saved-bar';
import { prepareSettings } from './settings-warm';

/** One row in the command palette. Pages publish their own rows; the palette adds its actions after them. */
export interface PaletteItem {
	id: string;
	group: string;
	label: string;
	/** Right-aligned text: a path or a count. */
	detail?: string;
	/** A key name shown as a keycap at the row's end (`?`, `mod+,`). */
	shortcut?: string;
	/** Extra words the search matches. */
	keywords?: string;
	icon?: ComponentType<{ className?: string }>;
	/** The icon's color, as a CSS value (`var(--sev-high-solid)`). */
	tone?: string;
	/** Choosing it leaves the palette open: it changes what the palette lists, or shows its progress in its row. */
	keepOpen?: boolean;
	run: () => void;
	/** Reads ahead what `run` opens, once the palette's selection has rested on the row. */
	prepare?: () => void;
}

/** A review open as a tab in the top bar. */
export interface ReviewTab {
	id: string;
	repo: string;
	pr: number;
	title: string;
	/** Decisions still open; null while the review runs. */
	open: number | null;
	/** True when any open decision is high. */
	high: boolean;
	/** The pull request's address, for the tab menu's copy item; absent until a page or the queue has read it. */
	url?: string | null;
	/** When the tab was last opened, so the least recent one closes first. */
	seenAt: number;
}

/** What a refresh can change on a tab that is already open. */
export type TabPatch = Pick<ReviewTab, 'id'> & Partial<Omit<ReviewTab, 'id' | 'seenAt'>>;

/** Which queue a count belongs to: the live one at `/` or the sample at `/sample`. */
export type QueueScope = 'live' | 'sample';

const MAX_TABS = 8;

/**
 * The longest the page a navigation leaves stays on screen by itself. A
 * review's address waits this long at most for the review and its diff to
 * be read, and a settings page's for its section's reads; and a page that
 * has not shown by then gives way to its skeleton, drawn by the shell
 * (`arriving`).
 */
const OPEN_WAIT_MS = 180;

/** True when the patch would change the tab. */
function changes(tab: ReviewTab, patch: TabPatch): boolean {
	return Object.entries(patch).some(([key, value]) => tab[key as keyof ReviewTab] !== value);
}

/** Adds or refreshes a tab in place; past the limit, the least recently opened other tab closes. */
function withTab(tabs: ReviewTab[], tab: ReviewTab): ReviewTab[] {
	const at = tabs.findIndex((item) => item.id === tab.id);

	if (at !== -1) return tabs.map((item, index) => (index === at ? tab : item));

	const next = [...tabs, tab];

	if (next.length <= MAX_TABS) return next;

	const oldest = next.filter((item) => item.id !== tab.id).sort((a, b) => a.seenAt - b.seenAt)[0];

	return next.filter((item) => item !== oldest);
}

/** A page a navigation is getting while the page it leaves still shows. */
interface Arriving {
	/** Its path, without the query. */
	path: string;
	/** When its navigation began, in ms (`Date.now()`). */
	since: number;
	/** True once it has waited past {@link OPEN_WAIT_MS}: the shell then draws its skeleton in the old page's place. */
	late: boolean;
	/**
	 * True once its address has gone out: the router has the push (or went
	 * there by itself), or a swap in place wrote the address. Until then the
	 * store holds it while a review or a settings section is read, and a page
	 * the router shows meanwhile leaves it waiting.
	 */
	sent: boolean;
}

/** What the shell asks of the router, which `RouteBridge` hands over. */
interface ShellRouter {
	push: (href: string) => void;
	/** Swaps the current entry for `href`, with no scroll: a way back to the page on screen that drops a navigation still under way. */
	replace: (href: string) => void;
	/** Prefetches the whole page; the router skips it in dev. */
	prefetch: (href: string) => void;
}

interface ShellState {
	paletteOpen: boolean;
	shortcutsOpen: boolean;
	pageItems: PaletteItem[];
	tabs: ReviewTab[];
	/**
	 * Pull requests that need a decision, for the Queue tab's badge, per queue:
	 * the badge counts the queue its tab leads to. Null until that queue has loaded.
	 */
	waiting: Record<QueueScope, number | null>;
	/**
	 * The tab a navigation from the bar is heading to, so the pill moves at
	 * once instead of when the page arrives. Cleared when a page arrives,
	 * unless a navigation the store still holds heads elsewhere.
	 */
	heading: string | null;
	/** The review a navigation waits on before it leaves the page, so the row or tab that opened it looks pressed. */
	opening: string | null;
	/**
	 * The page a navigation is getting, from the moment it begins until it
	 * shows or a later navigation drops it. Without a loading file the router
	 * keeps the page it leaves on screen until the new one can show whole;
	 * past {@link OPEN_WAIT_MS} the shell draws the new page's skeleton in its
	 * place.
	 */
	arriving: Arriving | null;
	/**
	 * The page's path, without its query. The shell reads it here rather than
	 * from the router, which re-renders every reader on each address write
	 * (a review's `?item=` moves with j and k), so the bar only renders when
	 * the page changes.
	 */
	pathname: string;
	/** False while something other than the app drives the store (the site's demo), so the tabs never reach local storage. */
	persistTabs: boolean;
	/**
	 * Goes to `href` through the router. A review's address waits for its
	 * review, as {@link ShellState.openReview} does, and a settings page for
	 * the reads its section paints from, each for at most
	 * {@link OPEN_WAIT_MS}, with the page prefetched meanwhile, so the router
	 * fetches it alongside the reads. From one settings page to another the
	 * section swaps in place, as the settings nav does. Going to the page on
	 * screen drops a navigation still under way.
	 */
	navigate: (href: string) => void;
	/**
	 * Opens review `id` through `go` once it can paint whole: the page on
	 * screen stays while the review and its diff are read (joining a read
	 * ahead still in flight), for at most {@link OPEN_WAIT_MS}. A review kept
	 * in memory, the sample and the review on screen go at once. A later
	 * navigation drops a wait still running. `go` swaps the page in place
	 * (the history API), so nothing goes through the router; past the wait
	 * the review's skeleton takes the old page's place, as for any page.
	 */
	openReview: (id: string, go: () => void) => void;
	/**
	 * The router goes to `href` by itself: a link the app does not handle,
	 * Back or Forward. It counts as a navigation like any other: it drops a
	 * wait still running, and its page arrives as `navigate`'s do. A link to
	 * the page on screen sends the router back to it, so a navigation the
	 * router has not shown yet never lands after it.
	 */
	follow: (href: string) => void;
	/** Prefetches page `href` ahead of a likely visit (a queue row the pointer rests on, a tab in the bar). */
	prefetch: (href: string) => void;
	setPaletteOpen: (open: boolean) => void;
	setShortcutsOpen: (open: boolean) => void;
	/**
	 * Closes the palette and the shortcuts sheet. A page change takes them
	 * down, Back and Forward included, and so does `mod+,` on its way to
	 * settings: left open, a sheet for the page that went would keep its scrim
	 * over the new one.
	 */
	closeOverlays: () => void;
	setPageItems: (items: PaletteItem[]) => void;
	setWaiting: (scope: QueueScope, count: number | null) => void;
	setHeading: (id: string | null) => void;
	/**
	 * Takes the router's new path. A new page ends the navigation under way,
	 * its heading, wait and page arriving, unless that navigation is one the
	 * store still holds for another page (a review or settings section being
	 * read): a page the router shows meanwhile, from an earlier navigation,
	 * does not drop it.
	 */
	setRoute: (pathname: string) => void;
	/** Adds a tab or refreshes it; fields the update leaves out keep their saved value. */
	openTab: (tab: Omit<ReviewTab, 'seenAt'>, seen?: boolean) => void;
	/** Updates tabs that are open and leaves the rest alone, so a refresh never reopens a closed tab. */
	patchTabs: (patches: TabPatch[]) => void;
	closeTabs: (ids: string[]) => void;
	/** Takes the router, which every navigation goes through. */
	setNavigate: (router: ShellRouter) => void;
	setPersistTabs: (persistTabs: boolean) => void;
}

/**
 * The page whose skeleton the shell draws in the canvas: one a navigation has
 * kept waiting past {@link OPEN_WAIT_MS}. Null for none.
 */
export function lateArrival(state: Pick<ShellState, 'arriving'>): string | null {
	return state.arriving?.late ? state.arriving.path : null;
}

/** An address's path, without its query or hash. */
function pathOf(href: string): string {
	return href.split(/[?#]/)[0];
}

/** True when review `id` paints at once: the sample, the review on screen, or a copy kept in memory. */
function paintsAtOnce(id: string, pathname: string): boolean {
	return isSampleReview(id) || reviewId(pathname) === id || cachedReview(id) !== null;
}

/** The address of the page on screen, with its query while the address bar still shows it (a review's `?item=`). */
function onScreen(pathname: string): string {
	return window.location.pathname === pathname ? `${pathname}${window.location.search}` : pathname;
}

export const useShell = create<ShellState>((set, get) => {
	/** The router, once the shell hands it over; until then a push is a full page load. */
	let router: ShellRouter = { push: (href) => window.location.assign(href), replace: () => {}, prefetch: () => {} };
	/** Navigations started so far: a wait that a later one overtook goes nowhere. */
	let navigations = 0;
	/** Turns the page arriving late once it has waited {@link OPEN_WAIT_MS}. */
	let lateTimer: ReturnType<typeof setTimeout> | undefined;

	/** Takes the new tab list, saving it first unless saving is off. */
	function setTabs(tabs: ReviewTab[]): void {
		if (get().persistTabs) saveTabs(tabs);

		set({ tabs });
	}

	/** The page arriving at `path` has waited long enough: its skeleton takes the old page's place. */
	function late(path: string): void {
		const { arriving } = get();

		if (arriving?.path === path && !arriving.late) set({ arriving: { ...arriving, late: true } });
	}

	/** Ends the navigation under way: a wait still running goes nowhere, and no page arrives. */
	function end(): void {
		const { arriving, opening } = get();

		clearTimeout(lateTimer);
		navigations++;

		if (opening || arriving) set({ opening: null, arriving: null });
	}

	/**
	 * Starts a navigation to `path`, dropping any wait still running; `sent`
	 * when its address has already gone out. Its page arrives from now on,
	 * unless it is the page on screen. A skeleton the shell already shows
	 * turns into the new page's at once, since the person is looking at a
	 * skeleton, not a page.
	 */
	function begin(path: string, sent: boolean): number {
		const { arriving } = get();

		if (path === get().pathname) {
			end();

			return navigations;
		}

		clearTimeout(lateTimer);
		set({ opening: null, arriving: { path, since: Date.now(), late: !!arriving?.late, sent } });

		if (!arriving?.late) lateTimer = setTimeout(() => late(path), OPEN_WAIT_MS);

		return ++navigations;
	}

	/** Marks the page arriving at `path` as sent and sends it through `go`. */
	function send(path: string, go: () => void): void {
		const { arriving } = get();

		set({ opening: null, ...(arriving?.path === path ? { arriving: { ...arriving, sent: true } } : {}) });
		go();
	}

	/**
	 * Sends the address of the page at `path` through `go` once the page can
	 * paint whole: the page on screen stays while `ready` reads what the new
	 * one paints from, for at most {@link OPEN_WAIT_MS}. With nothing to read
	 * (`ready` null) or on the page on screen it goes at once, and so does any
	 * page while the router is still getting another, so that page never lands
	 * in between. A later navigation drops a wait still running. `opening`
	 * names the review the wait is for, so its row or tab looks pressed.
	 */
	function hold(path: string, ready: (() => Promise<unknown>) | null, go: () => void, opening?: string): void {
		const routing = get().arriving?.sent === true;
		const ticket = begin(path, false);

		if (routing || !ready || path === get().pathname) return send(path, go);

		if (opening) set({ opening });

		void within(
			ready().catch(() => null),
			OPEN_WAIT_MS,
			null
		).then(() => {
			if (ticket === navigations) send(path, go);
		});
	}

	/**
	 * What review `id` waits on before its page shows: its review and diff
	 * (joining a read ahead still in flight), or nothing for a review that
	 * paints at once.
	 */
	function reviewReady(id: string): (() => Promise<unknown>) | null {
		return paintsAtOnce(id, get().pathname) ? null : () => readReview(id);
	}

	return {
		paletteOpen: false,
		shortcutsOpen: false,
		pageItems: [],
		tabs: typeof window === 'undefined' ? [] : readTabs(),
		waiting: { live: null, sample: null },
		heading: null,
		opening: null,
		arriving: null,
		pathname: typeof window === 'undefined' ? '/' : window.location.pathname,
		persistTabs: true,
		navigate(href) {
			const path = pathOf(href);
			const id = reviewId(path);
			const { pathname, arriving } = get();

			if (id) {
				const ready = reviewReady(id);

				if (ready) router.prefetch(href);

				hold(path, ready, () => router.push(href), id);

				return;
			}

			if (!onSettings(path)) {
				begin(path, true);
				router.push(href);

				return;
			}

			const swap = onSettings(pathname) && path !== pathname && !arriving?.sent;

			if (!swap && path !== pathname) router.prefetch(href);

			hold(
				path,
				() => prepareSettings(path),
				swap ? () => window.history.pushState(null, '', href) : () => router.push(href)
			);
		},
		openReview: (id, go) => hold(reviewHref(id), reviewReady(id), go, id),
		follow(href) {
			const path = pathOf(href);
			const { arriving, pathname } = get();

			begin(path, true);

			if (path === pathname && arriving?.sent) router.replace(onScreen(pathname));
		},
		prefetch: (href) => router.prefetch(href),
		setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
		setShortcutsOpen: (shortcutsOpen) => set({ shortcutsOpen }),
		closeOverlays: () => set({ paletteOpen: false, shortcutsOpen: false }),
		setPageItems: (pageItems) => set({ pageItems }),
		setWaiting: (scope, count) => set({ waiting: { ...get().waiting, [scope]: count } }),
		setHeading: (heading) => set({ heading }),
		setRoute(pathname) {
			const { arriving } = get();

			if (pathname === get().pathname) return;

			if (arriving && !arriving.sent && arriving.path !== pathname) {
				set({ pathname });

				return;
			}

			set({ pathname, heading: null });
			end();
		},
		openTab(tab, seen = false) {
			const current = get().tabs.find((item) => item.id === tab.id);

			if (current && !seen && !changes(current, tab)) return;

			const tabs = withTab(get().tabs, { ...current, ...tab, seenAt: seen || !current ? Date.now() : current.seenAt });

			setTabs(tabs);
		},
		patchTabs(patches) {
			const byId = new Map(patches.map((patch) => [patch.id, patch]));
			let touched = false;

			const tabs = get().tabs.map((tab) => {
				const patch = byId.get(tab.id);

				if (!patch || !changes(tab, patch)) return tab;

				touched = true;

				return { ...tab, ...patch };
			});

			if (!touched) return;

			setTabs(tabs);
		},
		closeTabs(ids) {
			const tabs = get().tabs.filter((tab) => !ids.includes(tab.id));

			setTabs(tabs);
		},
		setNavigate(next) {
			router = next;
		},
		setPersistTabs: (persistTabs) => set({ persistTabs })
	};
});

/**
 * Another window of the app saved its tabs: take them, so this window's next
 * save builds on them instead of writing back the list it loaded with.
 */
function followOtherWindows(event: StorageEvent): void {
	if (event.key === TABS_KEY || event.key === null) useShell.setState({ tabs: readTabs() });
}

if (typeof window !== 'undefined') window.addEventListener('storage', followOtherWindows);
