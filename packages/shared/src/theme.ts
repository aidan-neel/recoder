/** The theme the person picked in Appearance. `system` follows the device. Shared by apps/web and apps/app. */
export type ThemeChoice = 'system' | 'light' | 'dark';

/** Where the choice is saved in localStorage. */
export const THEME_KEY = 'recoder-theme';

/** The browser chrome color for each mode, matching `--bg-chrome`. */
const CHROME = { light: '#ebe8e2', dark: '#0d0c0b' };

/** The saved choice; `system` when nothing valid is saved or storage is blocked. */
export function readTheme(): ThemeChoice {
	try {
		const saved = localStorage.getItem(THEME_KEY);

		if (saved === 'light' || saved === 'dark' || saved === 'system') return saved;
	} catch {}

	return 'system';
}

function resolveTheme(choice: ThemeChoice): 'light' | 'dark' {
	if (choice !== 'system') return choice;

	return matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

/** Forces a style and layout pass, so colors changed just before it are computed at once. */
function flushStyles(): number {
	return document.body.offsetHeight;
}

/**
 * Runs `swap` with every CSS transition off, so all colors change in one
 * frame instead of some fading from the old theme. The rule lifts two frames
 * later, once the new colors are computed and painted.
 */
function withoutTransitions(swap: () => void): void {
	const freeze = document.createElement('style');

	freeze.textContent = '*, *::before, *::after { transition: none !important; }';
	document.head.append(freeze);
	swap();
	flushStyles();
	requestAnimationFrame(() => requestAnimationFrame(() => freeze.remove()));
}

/** Shows a choice: the `dark` class, the color scheme and the browser chrome color. A change of mode never animates. */
export function applyTheme(choice: ThemeChoice): void {
	const mode = resolveTheme(choice);
	const root = document.documentElement;

	/** Flips the class and the color scheme together. */
	function show(): void {
		root.classList.toggle('dark', mode === 'dark');
		root.style.colorScheme = mode;
	}

	if (root.classList.contains('dark') === (mode === 'dark')) show();
	else withoutTransitions(show);

	document.querySelector('meta[name="color-scheme"]')?.setAttribute('content', mode);
	document.querySelector('meta[name="theme-color"]')?.setAttribute('content', CHROME[mode]);
}

/** Saves a choice and shows it. */
export function saveTheme(choice: ThemeChoice): void {
	try {
		localStorage.setItem(THEME_KEY, choice);
	} catch {}

	applyTheme(choice);
}
