import { applyTheme as apply, readTheme, saveTheme, type ThemeChoice } from '@recoder/shared';
import { create } from 'zustand';

/**
 * Points every theme-color meta at the chrome showing now. The layout's two
 * metas follow the device; a theme or palette picked in the app has to reach
 * the browser's own bar whatever the device prefers.
 */
export function syncChrome(): void {
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

/**
 * Applies the saved theme and follows the device while the choice is `system`. Returns the cleanup. The browser's
 * bar is brought along after the first paint: reading `--bg-chrome` forces the whole page's styles to be worked out,
 * about 10 ms that would otherwise sit between the app mounting and its first frame.
 */
export function followSystemTheme(): () => void {
	const media = matchMedia('(prefers-color-scheme: light)');

	function onChange(): void {
		if (useTheme.getState().choice === 'system') show('system');
	}

	apply(useTheme.getState().choice);

	const cancelSync = afterPaint(syncChrome);

	media.addEventListener('change', onChange);

	return () => {
		cancelSync();
		media.removeEventListener('change', onChange);
	};
}

/** Runs `task` once the next frame has painted. Returns the cancel. */
function afterPaint(task: () => void): () => void {
	let timer: ReturnType<typeof setTimeout> | undefined;

	const frame = requestAnimationFrame(() => {
		timer = setTimeout(task);
	});

	return () => {
		cancelAnimationFrame(frame);
		clearTimeout(timer);
	};
}
