import { create } from 'zustand';

import { readStored, writeStored } from '../shell/browser-storage';

/** Where the choice to show FYI notes is kept in this browser. */
const FYI_KEY = 'recoder.show-fyi.v1';

interface ShowFyiState {
	/** FYI notes beside the findings: in the Review tab, under their lines in Changes and in the Description's rail. */
	shown: boolean;
	toggle: () => void;
}

/** Whether FYI notes show; shown unless the person hid them, and kept across visits. */
export const useShowFyi = create<ShowFyiState>((set, get) => ({
	shown: typeof window === 'undefined' ? true : readStored(FYI_KEY) !== 'hidden',
	toggle() {
		const shown = !get().shown;

		writeStored(FYI_KEY, shown ? 'shown' : 'hidden');
		set({ shown });
	}
}));
