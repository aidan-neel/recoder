'use client';

import { Button, Tooltip } from '@recoder/ui';
import { PanelLeft } from 'lucide-react';

import { keepTooltipShutOnCarry, toggleSidebar } from '@/lib/shell/sidebar-toggle';
import { useSidebarShown } from '@/lib/shell/use-sidebar-shown';

/**
 * The page bar's button that brings a hidden sidebar back. It stays mounted
 * and opens from zero width as the sidebar leaves (`.sidebar-reveal` in
 * shell.css), so the breadcrumb beside it slides on the sidebar's clock
 * instead of jumping when the button mounts. While the sidebar shows it is
 * inert: out of the tab order and hidden from assistive tech. On a narrow
 * window, where the sidebar is a drawer, it shows whenever the drawer is shut.
 */
export function SidebarReveal() {
	const open = useSidebarShown();

	return (
		<span className="sidebar-reveal" data-sidebar-part="reveal" inert={open}>
			<Tooltip content="Show sidebar" shortcut="[" onFocus={keepTooltipShutOnCarry}>
				<Button variant="ghost" size="icon" aria-label="Show sidebar" data-sidebar-toggle onClick={toggleSidebar}>
					<PanelLeft />
				</Button>
			</Tooltip>
		</span>
	);
}
