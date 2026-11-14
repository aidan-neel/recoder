import { create } from 'zustand';

/** What the New screen starts: a review of a pull request, or a chat about the repository. */
export type ComposeMode = 'review' | 'chat';

interface ComposeModeState {
	mode: ComposeMode;
	setMode: (mode: ComposeMode) => void;
}

/** The New screen's mode. It holds for the visit, like the text, so coming back to the screen keeps it. */
export const useComposeMode = create<ComposeModeState>((set) => ({
	mode: 'review',
	setMode: (mode) => set({ mode })
}));
