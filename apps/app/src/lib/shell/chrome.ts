import { create } from 'zustand';

/** Where the sidebar's open state is kept in this browser. */
const SIDEBAR_KEY = 'recoder.sidebar.v1';

/** The saved sidebar state; open when nothing is saved or storage is blocked. */
function readSidebar(): boolean {
	try {
		return localStorage.getItem(SIDEBAR_KEY) !== 'closed';
	} catch {
		return true;
	}
}

/** Saves the sidebar state. A blocked or full storage is fine: the choice then holds for this visit only. */
function saveSidebar(open: boolean): void {
	try {
		localStorage.setItem(SIDEBAR_KEY, open ? 'open' : 'closed');
	} catch {}
}

interface ChromeState {
	sidebarOpen: boolean;
	paletteOpen: boolean;
	shortcutsOpen: boolean;
	toggleSidebar: () => void;
	setPaletteOpen: (open: boolean) => void;
	setShortcutsOpen: (open: boolean) => void;
}

/** The frame around the pages: whether the sidebar shows, and which of the two app-wide overlays is open. */
export const useChrome = create<ChromeState>((set, get) => ({
	sidebarOpen: typeof window === 'undefined' ? true : readSidebar(),
	paletteOpen: false,
	shortcutsOpen: false,
	toggleSidebar() {
		const sidebarOpen = !get().sidebarOpen;

		saveSidebar(sidebarOpen);
		set({ sidebarOpen });
	},
	setPaletteOpen: (paletteOpen) => set({ paletteOpen, shortcutsOpen: false }),
	setShortcutsOpen: (shortcutsOpen) => set({ shortcutsOpen, paletteOpen: false })
}));
