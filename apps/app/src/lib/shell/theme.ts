import { applyTheme as apply, readTheme, saveTheme, type ThemeChoice } from '@recoder/shared';
import { create } from 'zustand';

/**
 * Points every theme-color meta at the chrome showing now. The layout's two
 * metas follow the device; a theme picked in the app has to reach the
 * browser's own bar whatever the device prefers.
 */
function syncChrome(): void {
	const chrome = getComputedStyle(document.documentElement).getPropertyValue('--bg-chrome').trim();

	if (!chrome) return;

	for (const meta of document.querySelectorAll('meta[name="theme-color"]')) meta.setAttribute('content', chrome);
}

/** Shows a choice and brings the browser's bar along. */
function show(choice: ThemeChoice): void {
	apply(choice);
	syncChrome();
}

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
		syncChrome();
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
		if (useTheme.getState().choice === 'system') show('system');
	}

	show(useTheme.getState().choice);
	media.addEventListener('change', onChange);

	return () => media.removeEventListener('change', onChange);
}
