import type { ReviewSpeed } from '@recoder/shared';
import { create } from 'zustand';

/** What the New screen starts: a review of a pull request, or a chat about the repository. */
export type ComposeMode = 'review' | 'chat';

interface ComposeModeState {
	mode: ComposeMode;
	setMode: (mode: ComposeMode) => void;
	/** How fast a review started here runs: the standard review, or Spark. */
	speed: ReviewSpeed;
	setSpeed: (speed: ReviewSpeed) => void;
}

/** The New screen's mode and review speed. They hold for the visit, like the text, so coming back to the screen keeps them. */
export const useComposeMode = create<ComposeModeState>((set) => ({
	mode: 'review',
	setMode: (mode) => set({ mode }),
	speed: 'standard',
	setSpeed: (speed) => set({ speed })
}));
