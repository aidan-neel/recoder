import type { ReactNode } from 'react';

import { SidebarReveal } from '@/components/shell/sidebar-reveal';

interface PageProps {
	/** The left of the 44px bar: a breadcrumb or the page's scope control. */
	start?: ReactNode;
	/** The right of the bar: the page's own actions. */
	end?: ReactNode;
	children: ReactNode;
}

/** One page beside the sidebar: a 44px bar, then the page's own content, which lays out and scrolls itself. */
export function Page({ start, end, children }: PageProps) {
	return (
		<main className="page">
			<header className="page-bar" data-chrome>
				<SidebarReveal />
				<div className="page-bar-side">{start}</div>
				<div className="page-bar-side" data-side="end">
					{end}
				</div>
			</header>
			{children}
		</main>
	);
}
