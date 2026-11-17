import { create } from 'zustand';

import { SETTINGS_SECTIONS, type SettingsSection } from '../settings/sections';
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

interface ChromeState {
	sidebarOpen: boolean;
	paletteOpen: boolean;
	shortcutsOpen: boolean;
	/** The section the Settings dialog shows, or null while it is closed. */
	settingsSection: SettingsSection | null;
	toggleSidebar: () => void;
	setPaletteOpen: (open: boolean) => void;
	setShortcutsOpen: (open: boolean) => void;
	/** Opens Settings over the page, on `section` or the first one. */
	openSettings: (section?: SettingsSection) => void;
	closeSettings: () => void;
}

/** The frame around the pages: whether the sidebar shows, and which of the app-wide overlays is open. */
export const useChrome = create<ChromeState>((set, get) => ({
	sidebarOpen: typeof window === 'undefined' ? true : readSidebar(),
	paletteOpen: false,
	shortcutsOpen: false,
	settingsSection: null,
	toggleSidebar() {
		const sidebarOpen = !get().sidebarOpen;

		saveSidebar(sidebarOpen);
		set({ sidebarOpen });
	},
	setPaletteOpen: (paletteOpen) => set({ paletteOpen, shortcutsOpen: false }),
	setShortcutsOpen: (shortcutsOpen) => set({ shortcutsOpen, paletteOpen: false }),
	openSettings: (section = SETTINGS_SECTIONS[0].id) =>
		set({ settingsSection: section, paletteOpen: false, shortcutsOpen: false }),
	closeSettings: () => set({ settingsSection: null })
}));
