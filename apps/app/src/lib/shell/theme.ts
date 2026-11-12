import { applyTheme, readTheme, saveTheme, type ThemeChoice } from '@recoder/shared';
import { create } from 'zustand';

interface ThemeState {
	choice: ThemeChoice;
	set: (choice: ThemeChoice) => void;
	/** Swaps light and dark, from whatever is showing now. */
	toggle: () => void;
}

export const useTheme = create<ThemeState>((setState) => ({
	choice: typeof window === 'undefined' ? 'system' : readTheme(),
	set(choice) {
		saveTheme(choice);
		setState({ choice });
	},
	toggle() {
		useTheme.getState().set(document.documentElement.classList.contains('dark') ? 'light' : 'dark');
	}
}));

/** Applies the saved theme and follows the device while the choice is `system`. Returns the cleanup. */
export function followSystemTheme(): () => void {
	const media = matchMedia('(prefers-color-scheme: light)');

	function onChange(): void {
		if (useTheme.getState().choice === 'system') applyTheme('system');
	}

	applyTheme(useTheme.getState().choice);
	media.addEventListener('change', onChange);

	return () => media.removeEventListener('change', onChange);
}
