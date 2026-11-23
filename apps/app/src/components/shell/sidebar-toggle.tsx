'use client';

import { Button, Icon, Tooltip } from '@recoder/ui';

import { keepTooltipShutOnCarry, toggleSidebar } from '@/lib/shell/sidebar-toggle';
import { useSidebarShown } from '@/lib/shell/use-sidebar-shown';

/** The button that hides or shows the sidebar, named for what it will do. */
export function SidebarToggle() {
	const shown = useSidebarShown();
	const label = shown ? 'Close sidebar' : 'Open sidebar';

	return (
		<Tooltip content={label} shortcut="mod+b" onFocus={keepTooltipShutOnCarry}>
			<Button variant="ghost" size="icon" aria-label={label} data-sidebar-toggle onClick={toggleSidebar}>
				<Icon name="dock_to_right" />
			</Button>
		</Tooltip>
	);
}
