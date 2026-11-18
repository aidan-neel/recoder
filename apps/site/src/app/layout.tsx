import { Card } from '@recoder/ui';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import { MotionRoot } from '~/components/shell/motion-root';
import { SiteSidebar } from '~/components/shell/site-sidebar';
import { DOC_NAV } from '~/lib/docs';
import { SITE_URL } from '~/lib/site';

import './globals.css';

export const metadata: Metadata = {
	metadataBase: new URL(SITE_URL),
	title: 'Recoder'
};

/**
 * Dark only, in the app's skin (`app-skin`): the sidebar on the chrome and
 * the page in one canvas card beside it.
 */
export default function RootLayout({ children }: { children: ReactNode }) {
	return (
		<html lang="en" className="dark app-skin">
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
