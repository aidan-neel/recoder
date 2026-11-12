'use client';

import type { ThemeChoice } from '@recoder/shared';

import { useTheme } from '../shell/theme';

/** Everything the Appearance section shows and does. */
export interface AppearanceView {
	/** The theme choice on screen: system, light or dark. */
	choice: ThemeChoice;
	/** Picks a theme; it lives in this browser, so it works without the review server. */
	set: (choice: ThemeChoice) => void;
}

/** Settings → Appearance: the theme. */
export function useAppearance(): AppearanceView {
	const choice = useTheme((state) => state.choice);

	return { choice, set: (next) => useTheme.getState().set(next) };
}
