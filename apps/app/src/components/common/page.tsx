'use client';

import type { ReactNode } from 'react';

interface PageProps {
	/** The left of the 44px bar: a breadcrumb or the page's scope control. */
	start?: ReactNode;
	/** The right of the bar: the page's own actions. */
	end?: ReactNode;
	children: ReactNode;
}

/**
 * One page beside the sidebar, under the topbar: a 44px bar, then the page's own content, which lays out and scrolls itself. A page
 * change is static: the new page shows in the same frame, with only its skeleton standing in while it loads.
 */
export function Page({ start, end, children }: PageProps) {
	return (
		<main className="page" id="page" tabIndex={-1}>
			<header className="page-bar" data-chrome>
				<div className="page-bar-side">{start}</div>
				<div className="page-bar-side" data-side="end">
					{end}
				</div>
			</header>
			{children}
		</main>
	);
}
