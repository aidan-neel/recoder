import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import { EARLY_FETCH_SCRIPT } from '@/lib/api/early-fetch-script';
import { APPEARANCE_SCRIPT } from '@/lib/appearance/appearance-script';
import { FONT_SCRIPT } from '@/lib/appearance/font-script';
import { CHROME_VIEWPORT } from '@/lib/appearance/viewport';
import { PANEL_WIDTH_SCRIPT } from '@/lib/shell/panel-width-script';

import { ClientRoot } from '@/components/shell/client-root';

import './globals.css';

/** No title here: the browser names each screen itself (`Screens`), and a title Next renders would write over it. */
export const metadata: Metadata = {
	description: 'Recoder reviews pull requests on your machine and shows the bugs it can prove.'
};

export const viewport = CHROME_VIEWPORT;

export default function RootLayout({ children }: { children: ReactNode }) {
	return (
		<html lang="en" className="dark app-skin" suppressHydrationWarning>
			<head>
				<title>Recoder</title>
				<script dangerouslySetInnerHTML={{ __html: EARLY_FETCH_SCRIPT }} />
				<script dangerouslySetInnerHTML={{ __html: APPEARANCE_SCRIPT }} />
				<script dangerouslySetInnerHTML={{ __html: FONT_SCRIPT }} />
				<script dangerouslySetInnerHTML={{ __html: PANEL_WIDTH_SCRIPT }} />
			</head>
			<body>
				<ClientRoot>{children}</ClientRoot>
			</body>
		</html>
	);
}
