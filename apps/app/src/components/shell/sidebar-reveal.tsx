'use client';

import { Button, Tooltip } from '@recoder/ui';
import { PanelLeft } from 'lucide-react';

import { useChrome } from '@/lib/shell/chrome';
import { toggleSidebar } from '@/lib/shell/sidebar-toggle';

/**
 * The page bar's button that brings a hidden sidebar back. It stays mounted
 * and opens from zero width as the sidebar leaves (`.sidebar-reveal` in
 * shell.css), so the breadcrumb beside it slides on the sidebar's clock
 * instead of jumping when the button mounts. While the sidebar shows it is
 * inert: out of the tab order and hidden from assistive tech.
 */
export function SidebarReveal() {
	const open = useChrome((state) => state.sidebarOpen);

	return (
		<span className="sidebar-reveal" data-sidebar-part="reveal" inert={open}>
			<Tooltip content="Show sidebar" shortcut="[">
				<Button variant="ghost" size="icon" aria-label="Show sidebar" data-sidebar-toggle onClick={toggleSidebar}>
					<PanelLeft />
				</Button>
			</Tooltip>
		</span>
	);
}
