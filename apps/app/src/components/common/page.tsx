'use client';

import { Button, Tooltip } from '@recoder/ui';
import { PanelLeft } from 'lucide-react';
import type { ReactNode } from 'react';

import { useChrome } from '@/lib/shell/chrome';

interface PageProps {
	/** The left of the 44px bar: a breadcrumb or the page's scope control. */
	start?: ReactNode;
	/** The right of the bar: the page's own actions. */
	end?: ReactNode;
	children: ReactNode;
}

/** Brings the sidebar back, from the bar of whichever page shows while it is hidden. */
function ShowSidebar() {
	const open = useChrome((state) => state.sidebarOpen);
	const toggle = useChrome((state) => state.toggleSidebar);

	if (open) return null;

	return (
		<Tooltip content="Show sidebar" shortcut="[">
			<Button variant="ghost" size="icon" className="sidebar-open" aria-label="Show sidebar" onClick={toggle}>
				<PanelLeft />
			</Button>
		</Tooltip>
	);
}

/** One page beside the sidebar: a 44px bar, then the page's own content, which lays out and scrolls itself. */
export function Page({ start, end, children }: PageProps) {
	return (
		<main className="page">
			<header className="page-bar" data-chrome>
				<ShowSidebar />
				<div className="page-bar-side">{start}</div>
				<div className="page-bar-side" data-side="end">
					{end}
				</div>
			</header>
			{children}
		</main>
	);
}
