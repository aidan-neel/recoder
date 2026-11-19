import { create } from 'zustand';

import { readStored, writeStored } from './browser-storage';

/** Where the sidebar's open state is kept in this browser. */
const SIDEBAR_KEY = 'recoder.sidebar.v1';

/** The saved sidebar state; open when nothing is saved or storage is blocked. */
function readSidebar(): boolean {
	return readStored(SIDEBAR_KEY) !== 'closed';
}

/** Saves the sidebar state; with storage blocked or full the choice holds for this visit only. */
function saveSidebar(open: boolean): void {
	writeStored(SIDEBAR_KEY, open ? 'open' : 'closed');
}

/** Below this width the sidebar is a drawer over the page, not a column beside it. Keep in step with narrow.css. */
const NARROW_QUERY = '(max-width: 1023px)';

/** The media query the drawer layout follows; null on the server. */
export function narrowQuery(): MediaQueryList | null {
	return typeof window === 'undefined' ? null : window.matchMedia(NARROW_QUERY);
}

interface ChromeState {
	/** The sidebar as a column beside the page; kept across visits. */
	sidebarOpen: boolean;
	/** The sidebar as a drawer over the page, on a narrow window; shut on every load and after every navigation. */
	drawerOpen: boolean;
	paletteOpen: boolean;
	shortcutsOpen: boolean;
	/** Hides or shows the sidebar in the form the window's width gives it. */
	toggleSidebar: () => void;
	setDrawerOpen: (open: boolean) => void;
	setPaletteOpen: (open: boolean) => void;
	setShortcutsOpen: (open: boolean) => void;
}

/** True when the sidebar is on screen, as a column or as an open drawer. */
export function sidebarShown(state: Pick<ChromeState, 'sidebarOpen' | 'drawerOpen'>, narrow: boolean): boolean {
	return narrow ? state.drawerOpen : state.sidebarOpen;
}

/** The frame around the pages: whether the sidebar shows, and which of the app-wide overlays is open. */
export const useChrome = create<ChromeState>((set, get) => ({
	sidebarOpen: typeof window === 'undefined' ? true : readSidebar(),
	paletteOpen: false,
	shortcutsOpen: false,
	drawerOpen: false,
	toggleSidebar() {
		if (narrowQuery()?.matches) {
			set({ drawerOpen: !get().drawerOpen });

			return;
		}

		const sidebarOpen = !get().sidebarOpen;

		saveSidebar(sidebarOpen);
		set({ sidebarOpen });
	},
	setDrawerOpen: (drawerOpen) => set({ drawerOpen }),
	setPaletteOpen: (paletteOpen) => set({ paletteOpen, shortcutsOpen: false }),
	setShortcutsOpen: (shortcutsOpen) => set({ shortcutsOpen, paletteOpen: false })
}));
