import type { Viewport } from 'next';

/** The dark chrome (`--bg-chrome`), the color the apps paint before a theme is known. */
export const CHROME_DARK = '#0f0f10';

/**
 * The browser's own bar follows the device in the chrome's colors until the
 * appearance script and the theme store take over (`--bg-chrome`). The app
 * and the site both use it.
 */
export const CHROME_VIEWPORT: Viewport = {
	themeColor: [
		{ media: '(prefers-color-scheme: light)', color: '#f4f4f5' },
		{ media: '(prefers-color-scheme: dark)', color: CHROME_DARK }
	],
	colorScheme: 'dark light'
};
