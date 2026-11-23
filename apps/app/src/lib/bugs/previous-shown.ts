import { create } from 'zustand';

interface PreviousShownState {
	/** The previous review's findings, open on the Review tab under a running review. */
	shown: boolean;
	setShown: (shown: boolean) => void;
}

/** Whether the previous review's findings are open: shut until the person opens them, and kept until the page reloads. */
export const usePreviousShown = create<PreviousShownState>((set) => ({
	shown: false,
	setShown: (shown) => set({ shown })
}));
