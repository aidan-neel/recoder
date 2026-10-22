import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';

import { ClientRoot } from '@/components/shell/client-root';
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

export default function RootLayout({ children }: { children: ReactNode }) {
	return (
		<html lang="en" className="dark" suppressHydrationWarning>
			<head>
				<script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
			</head>
			<body>
				<ClientRoot>{children}</ClientRoot>
			</body>
		</html>
	);
}
