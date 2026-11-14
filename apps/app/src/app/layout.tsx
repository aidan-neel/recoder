import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';

import { APPEARANCE_SCRIPT } from '@/lib/appearance/appearance-script';
import { PANEL_WIDTH_SCRIPT } from '@/lib/shell/panel-width-script';

import { ClientRoot } from '@/components/shell/client-root';

import './globals.css';

export const metadata: Metadata = {
	title: { default: 'Recoder', template: '%s · Recoder' },
	description: 'Recoder reviews pull requests on your machine and shows the bugs it can prove.'
};

/** The browser's own bar follows the device until the appearance script and the theme store take over (`--bg-chrome`). */
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
				<script dangerouslySetInnerHTML={{ __html: APPEARANCE_SCRIPT }} />
				<script dangerouslySetInnerHTML={{ __html: PANEL_WIDTH_SCRIPT }} />
			</head>
			<body>
				<ClientRoot>{children}</ClientRoot>
			</body>
		</html>
	);
}
