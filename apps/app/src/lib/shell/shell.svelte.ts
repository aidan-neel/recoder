import type { Component } from 'svelte';

/** A palette row a page offers while it is open: a decision, a file, an action. */
export interface PaletteItem {
	id: string;
	group: string;
	label: string;
	/** Right-aligned detail: a path, a shortcut. */
	detail?: string;
	/** Extra words the search matches. */
	keywords?: string;
	icon?: Component;
	/** Colour for the icon. */
	tone?: string;
	run: () => void;
}

/** A review open as a tab beside Queue, like apps/web's session tabs. */
export interface ReviewTab {
	id: string;
	repo: string;
	pr: number;
	title: string;
	/** Open decisions, shown as the tab badge; null while reviewing. */
	open: number | null;
	high: boolean;
}

const TABS_KEY = 'recoder.app.tabs.v1';

/** Tabs past this many drop the oldest, so the bar never clips. */
const MAX_TABS = 6;

function readTabs(): ReviewTab[] {
	try {
		return JSON.parse(localStorage.getItem(TABS_KEY) ?? '[]');
	} catch {
		return [];
	}
}

/** App-wide UI state: the palette, the review tabs and what the open page offers. */
class Shell {
	paletteOpen = $state(false);
	shortcutsOpen = $state(false);
	pageItems = $state<PaletteItem[]>([]);
	tabs = $state<ReviewTab[]>(typeof localStorage === 'undefined' ? [] : readTabs());
	/** Pull requests waiting on a decision, for the Queue tab's count. */
	waiting = $state<number | null>(null);

	/** Open or refresh a review's tab, keeping its place in the bar. */
	openTab(tab: ReviewTab): void {
		const at = this.tabs.findIndex((item) => item.id === tab.id);

		this.tabs =
			at === -1 ? [...this.tabs, tab].slice(-MAX_TABS) : this.tabs.map((item, index) => (index === at ? tab : item));

		this.saveTabs();
	}

	closeTabs(ids: string[]): void {
		this.tabs = this.tabs.filter((tab) => !ids.includes(tab.id));
		this.saveTabs();
	}

	private saveTabs(): void {
		try {
			localStorage.setItem(TABS_KEY, JSON.stringify(this.tabs));
		} catch {}
	}
}

export const shell = new Shell();
