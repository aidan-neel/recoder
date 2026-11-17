import { create } from 'zustand';

import { readStoredJson, writeStored } from './browser-storage';

/** A sidebar list a person can fold away or hide. */
export type SidebarList = 'repos' | 'chats' | 'reviews';

/** Where the folded lists are kept in this browser. */
const FOLDS_KEY = 'recoder.sidebar-folds.v1';

/** Where the hidden lists are kept in this browser. */
const HIDDEN_KEY = 'recoder.sidebar-hidden.v1';

const LISTS: readonly SidebarList[] = ['repos', 'chats', 'reviews'];

interface ListsState {
	/** Lists showing only their title. */
	folded: readonly SidebarList[];
	/** Lists left out of the sidebar, title and all. */
	hidden: readonly SidebarList[];
	setOpen: (list: SidebarList, open: boolean) => void;
	setShown: (list: SidebarList, shown: boolean) => void;
}

/** `lists` with `list` in it when `inList`, and out of it otherwise. */
function withList(lists: readonly SidebarList[], list: SidebarList, inList: boolean): SidebarList[] {
	const others = lists.filter((other) => other !== list);

	return inList ? [...others, list] : others;
}

/** Which sidebar lists are folded and which are hidden; each stays as the person left it, in this browser. */
export const useSidebarFolds = create<ListsState>((set, get) => ({
	folded: typeof window === 'undefined' ? [] : readLists(FOLDS_KEY),
	hidden: typeof window === 'undefined' ? [] : readLists(HIDDEN_KEY),
	setOpen(list, open) {
		const folded = withList(get().folded, list, !open);

		writeStored(FOLDS_KEY, JSON.stringify(folded));
		set({ folded });
	},
	setShown(list, shown) {
		const hidden = withList(get().hidden, list, !shown);

		writeStored(HIDDEN_KEY, JSON.stringify(hidden));
		set({ hidden });
	}
}));

/** The lists saved under `key`; none when nothing is saved, it does not parse, or storage is blocked. Unknown names are dropped. */
function readLists(key: string): SidebarList[] {
	const saved = readStoredJson(key);

	if (!Array.isArray(saved)) return [];

	return LISTS.filter((list) => saved.includes(list));
}
