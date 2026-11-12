import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';

import { AppShell } from '@/components/shell/app-shell';
import { BOOT_SCRIPT } from '@/lib/shell/boot-script';
import { THEME_SCRIPT } from '@/lib/shell/theme-script';

import './globals.css';

export const metadata: Metadata = {
	title: { default: 'Recoder', template: '%s · Recoder' },
	description: 'Recoder reviews pull requests on your machine and shows what needs your decision.'
};

/** The browser's own bar follows the device until the app's theme script and theme store take over (`--bg-chrome`). */
export const viewport: Viewport = {
	themeColor: [
		{ media: '(prefers-color-scheme: light)', color: '#ebe8e2' },
		{ media: '(prefers-color-scheme: dark)', color: '#0d0c0b' }
	],
	colorScheme: 'dark light'
};

/**
 * The document. The head scripts run before first paint: the theme, the
 * platform for the boot frame's keycap, and the watchdog that offers a reload
 * when the app never mounts. The shell's server render is the boot frame, so
 * the first paint already shows the top bar, the canvas and the page's skeleton.
 */
export default function RootLayout({ children }: { children: ReactNode }) {
	return (
		<html lang="en" className="dark" suppressHydrationWarning>
			<head>
				<script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
				<script dangerouslySetInnerHTML={{ __html: BOOT_SCRIPT }} />
			</head>
			<body>
				<AppShell>{children}</AppShell>
			</body>
		</html>
	);
}
