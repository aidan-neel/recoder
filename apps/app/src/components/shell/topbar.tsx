'use client';

import { Button, Icon, Tooltip } from '@recoder/ui';
import { useStore } from 'zustand';

import { useListStore } from '@/lib/api/client';
import { useChrome } from '@/lib/shell/chrome';

import { AccountMenu } from './account-menu';
import { SidebarToggle } from './sidebar-toggle';
import { WindowTabs } from './window-tabs';

/**
 * The bar across the top of the window. Over the sidebar: the account at its left, and Search and the sidebar's toggle
 * at its right edge. Beside them, from the page's left edge, the window's tabs and the + that starts a new review. With
 * the sidebar hidden, as in Capy, the toggle stands alone at the window's left and the tabs start right after it; ⌘K
 * still opens Search. Back and Forward have no buttons: ⌘[ and ⌘] and the browser's own walk the tab on screen.
 */
export function Topbar() {
	const { state } = useListStore();
	const account = useStore(state, (data) => data.account);
	const setPaletteOpen = useChrome((chrome) => chrome.setPaletteOpen);

	return (
		<header className="topbar" data-chrome>
			<div className="topbar-lead">
				<div className="topbar-side">
					<AccountMenu account={account} />
					<Tooltip content="Search" shortcut="mod+k">
						<Button variant="ghost" size="icon" aria-label="Search" onClick={() => setPaletteOpen(true)}>
							<Icon name="search" />
						</Button>
					</Tooltip>
				</div>
				<SidebarToggle />
			</div>
			<WindowTabs />
		</header>
	);
}
