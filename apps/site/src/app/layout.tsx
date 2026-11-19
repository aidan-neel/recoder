import { Card } from '@recoder/ui';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import { APPEARANCE_SCRIPT } from '@/lib/appearance/appearance-script';
import { CHROME_VIEWPORT } from '@/lib/appearance/viewport';

import { MotionRoot } from '~/components/shell/motion-root';
import { SiteSidebar } from '~/components/shell/site-sidebar';
import { DOC_NAV } from '~/lib/docs';
import { SITE_URL } from '~/lib/site';

import './globals.css';

export const metadata: Metadata = {
	metadataBase: new URL(SITE_URL),
	title: 'Recoder',
	twitter: { card: 'summary_large_image' }
};

export const viewport = CHROME_VIEWPORT;

/**
 * The app's skin (`app-skin`) in the app's themes: the sidebar on the chrome
 * and the page in one canvas card beside it. The app's appearance script
 * picks dark or light before the first paint, from the visitor's choice or
 * the device.
 */
export default function RootLayout({ children }: { children: ReactNode }) {
	return (
		<html lang="en" className="dark app-skin" suppressHydrationWarning>
			<head>
				<script dangerouslySetInnerHTML={{ __html: APPEARANCE_SCRIPT }} />
			</head>
			<body>
				<MotionRoot>
					<div className="site-shell">
						<SiteSidebar pages={DOC_NAV} />
						<Card className="site-card">
							<main className="site-main">{children}</main>
						</Card>
					</div>
				</MotionRoot>
			</body>
		</html>
	);
}
