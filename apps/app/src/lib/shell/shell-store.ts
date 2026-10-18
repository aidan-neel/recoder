import type { ComponentType } from 'react';
import { create } from 'zustand';

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

const TABS_KEY = 'recoder.app.tabs.v2';
const MAX_TABS = 8;

/** Saved tabs, keeping only well-formed entries. */
function readTabs(): ReviewTab[] {
	try {
		const value: unknown = JSON.parse(localStorage.getItem(TABS_KEY) ?? '[]');

		return Array.isArray(value)
			? value.filter((tab): tab is ReviewTab => typeof tab?.id === 'string' && typeof tab?.pr === 'number')
			: [];
	} catch {
		return [];
	}
}

function saveTabs(tabs: ReviewTab[]): void {
	try {
		localStorage.setItem(TABS_KEY, JSON.stringify(tabs));
	} catch {}
}

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
	 * once instead of when the page arrives. The bar clears it on every route change.
	 */
	heading: string | null;
	/** False while something other than the app drives the store (the site's demo), so the tabs never reach local storage. */
	persistTabs: boolean;
	navigate: (href: string) => void;
	setPaletteOpen: (open: boolean) => void;
	setShortcutsOpen: (open: boolean) => void;
	setPageItems: (items: PaletteItem[]) => void;
	setWaiting: (scope: QueueScope, count: number | null) => void;
	setHeading: (id: string | null) => void;
	/** Adds a tab or refreshes it; fields the update leaves out keep their saved value. */
	openTab: (tab: Omit<ReviewTab, 'seenAt'>, seen?: boolean) => void;
	/** Updates tabs that are open and leaves the rest alone, so a refresh never reopens a closed tab. */
	patchTabs: (patches: TabPatch[]) => void;
	closeTabs: (ids: string[]) => void;
	setNavigate: (navigate: (href: string) => void) => void;
	setPersistTabs: (persistTabs: boolean) => void;
}

export const useShell = create<ShellState>((set, get) => {
	/** Takes the new tab list, saving it first unless saving is off. */
	function setTabs(tabs: ReviewTab[]): void {
		if (get().persistTabs) saveTabs(tabs);

		set({ tabs });
	}

	return {
		paletteOpen: false,
		shortcutsOpen: false,
		pageItems: [],
		tabs: typeof window === 'undefined' ? [] : readTabs(),
		waiting: { live: null, sample: null },
		heading: null,
		persistTabs: true,
		navigate: (href) => window.location.assign(href),
		setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
		setShortcutsOpen: (shortcutsOpen) => set({ shortcutsOpen }),
		setPageItems: (pageItems) => set({ pageItems }),
		setWaiting: (scope, count) => set({ waiting: { ...get().waiting, [scope]: count } }),
		setHeading: (heading) => set({ heading }),
		openTab(tab, seen = false) {
			const current = get().tabs.find((item) => item.id === tab.id);
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
		setNavigate: (navigate) => set({ navigate }),
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
