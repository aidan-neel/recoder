import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';

import { THEME_SCRIPT } from '@/lib/shell/theme-script';

import { ClientRoot } from '@/components/shell/client-root';

import './globals.css';

export const metadata: Metadata = {
	title: { default: 'Recoder', template: '%s · Recoder' },
	description: 'Recoder reviews pull requests on your machine and shows the bugs it can prove.'
};

/** The browser's own bar follows the device until the theme script and the theme store take over (`--bg-chrome`). */
export const viewport: Viewport = {
	themeColor: [
		{ media: '(prefers-color-scheme: light)', color: '#f6f6f6' },
		{ media: '(prefers-color-scheme: dark)', color: '#161616' }
	],
	colorScheme: 'dark light'
};

export default function RootLayout({ children }: { children: ReactNode }) {
	return (
		<html lang="en" className="dark app-skin" suppressHydrationWarning>
			<head>
				<script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
			</head>
			<body>
				<ClientRoot>{children}</ClientRoot>
			</body>
		</html>
	);
}
