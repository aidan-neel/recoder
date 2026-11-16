import { create } from 'zustand';

import { readStoredJson, writeStored } from './browser-storage';

/** A sidebar list a person can fold away. */
export type FoldableSection = 'repos' | 'chats' | 'reviews';

/** Where the folded sections are kept in this browser. */
const FOLDS_KEY = 'recoder.sidebar-folds.v1';

const SECTIONS: readonly FoldableSection[] = ['repos', 'chats', 'reviews'];

interface FoldsState {
	folded: readonly FoldableSection[];
	setOpen: (section: FoldableSection, open: boolean) => void;
}

/** Which sidebar lists are folded; each stays as the person left it, in this browser. */
export const useSidebarFolds = create<FoldsState>((set, get) => ({
	folded: typeof window === 'undefined' ? [] : readFolds(),
	setOpen(section, open) {
		const others = get().folded.filter((folded) => folded !== section);
		const folded = open ? others : [...others, section];

		writeStored(FOLDS_KEY, JSON.stringify(folded));
		set({ folded });
	}
}));

/** The saved folds; none when nothing is saved, it does not parse, or storage is blocked. */
function readFolds(): FoldableSection[] {
	const saved = readStoredJson(FOLDS_KEY);

	if (!Array.isArray(saved)) return [];

	return SECTIONS.filter((section) => saved.includes(section));
}
