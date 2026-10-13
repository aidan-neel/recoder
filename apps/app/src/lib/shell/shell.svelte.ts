import type { Component } from 'svelte';

/** A palette row a page offers while it is open: a decision, a file, an action. */
export interface PaletteItem {
	id: string;
	group: string;
	label: string;
	/** Right-aligned mono detail: a path, a shortcut. */
	detail?: string;
	/** Extra words the search matches. */
	keywords?: string;
	icon?: Component;
	/** Severity colour for the icon. */
	tone?: string;
	run: () => void;
}

/** Where the top bar says you are, after the wordmark. */
interface Crumb {
	label: string;
	detail?: string;
}

/** App-wide UI state: the palette and what the open page puts in it. */
class Shell {
	paletteOpen = $state(false);
	pageItems = $state<PaletteItem[]>([]);
	crumb = $state<Crumb | null>(null);
	/** Pull requests waiting on a decision, for the Queue count in the top bar. */
	waiting = $state<number | null>(null);
}

export const shell = new Shell();
