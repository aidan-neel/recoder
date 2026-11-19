import { create } from 'zustand';

import { readStored, writeStored } from '../shell/browser-storage';

/** Where the diff's layout and whitespace choices are kept in this browser. */
const LAYOUT_KEY = 'recoder.changes-layout.v1';
const WHITESPACE_KEY = 'recoder.changes-whitespace.v1';

/** How the Changes tab lays out each diff: one column, or removed and added side by side. */
export type DiffLayout = 'unified' | 'split';

interface DiffViewState {
	layout: DiffLayout;
	/** Changes that only touch whitespace read as unchanged lines. */
	hideWhitespace: boolean;
	setLayout: (layout: DiffLayout) => void;
	toggleWhitespace: () => void;
}

/** How the Changes tab shows its diffs, kept across visits. */
export const useDiffView = create<DiffViewState>((set, get) => ({
	layout: typeof window !== 'undefined' && readStored(LAYOUT_KEY) === 'split' ? 'split' : 'unified',
	hideWhitespace: typeof window !== 'undefined' && readStored(WHITESPACE_KEY) === 'hide',
	setLayout(layout) {
		writeStored(LAYOUT_KEY, layout);
		set({ layout });
	},
	toggleWhitespace() {
		const hideWhitespace = !get().hideWhitespace;

		writeStored(WHITESPACE_KEY, hideWhitespace ? 'hide' : 'show');
		set({ hideWhitespace });
	}
}));
