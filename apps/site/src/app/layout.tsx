import { Card } from '@recoder/ui';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import { MotionRoot } from '~/components/shell/motion-root';
import { SiteNav } from '~/components/shell/site-nav';
import { SITE_URL } from '~/lib/site';

import './globals.css';

export const metadata: Metadata = {
	metadataBase: new URL(SITE_URL),
	title: 'Recoder'
};

/** Dark only: one canvas card on the chrome, the nav inside it and the page beside it. No visible page scrollbar. */
export default function RootLayout({ children }: { children: ReactNode }) {
	return (
		<html lang="en" className="dark no-scrollbar">
			<body>
				<MotionRoot>
					<div className="site-shell">
						<Card className="site-card">
							<SiteNav />
							<main className="site-main">{children}</main>
						</Card>
					</div>
				</MotionRoot>
			</body>
		</html>
	);
}
