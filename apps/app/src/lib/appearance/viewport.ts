import type { Viewport } from 'next';

/**
 * The browser's own bar follows the device in the chrome's colors until the
 * appearance script and the theme store take over (`--bg-chrome`). The app
 * and the site both use it.
 */
export const CHROME_VIEWPORT: Viewport = {
	themeColor: [
		{ media: '(prefers-color-scheme: light)', color: '#f4f4f5' },
		{ media: '(prefers-color-scheme: dark)', color: '#0f0f10' }
	],
	colorScheme: 'dark light'
};
