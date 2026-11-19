import { create } from 'zustand';

import { readStored, writeStored } from '../shell/browser-storage';

/** Where the file sidebar's open state is kept in this browser. */
const SIDE_KEY = 'recoder.changes-side.v1';

interface SideOpenState {
	/** The file sidebar beside the diff on a wide page; kept across visits. */
	open: boolean;
	toggle: () => void;
}

/** Whether the Changes tab shows its file sidebar; open unless the person shut it. */
export const useSideOpen = create<SideOpenState>((set, get) => ({
	open: typeof window === 'undefined' ? true : readStored(SIDE_KEY) !== 'closed',
	toggle() {
		const open = !get().open;

		writeStored(SIDE_KEY, open ? 'open' : 'closed');
		set({ open });
	}
}));
