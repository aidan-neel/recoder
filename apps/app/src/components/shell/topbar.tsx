'use client';

import { Button, Tooltip } from '@recoder/ui';
import { MagnifyingGlassIcon } from '@phosphor-icons/react';
import { useStore } from 'zustand';

import { useListStore } from '@/lib/api/client';
import { useChrome } from '@/lib/shell/chrome';

import { AccountMenu } from './account-menu';
import { SidebarToggle } from './sidebar-toggle';
import { WindowTabs } from './window-tabs';

/**
 * The bar across the top of the window. Over the sidebar: the account at its left, and Search and the sidebar's toggle
 * at its right edge. Beside them, from the page's left edge, the window's tabs and the + that starts a new review. Back
 * and Forward have no buttons: ⌘[ and ⌘] and the browser's own walk the tab on screen.
 */
export function Topbar() {
	const { state } = useListStore();
	const account = useStore(state, (data) => data.account);
	const setPaletteOpen = useChrome((chrome) => chrome.setPaletteOpen);

	return (
		<header className="topbar" data-chrome>
			<div className="topbar-lead">
				<AccountMenu account={account} />
				<div className="topbar-tools">
					<Tooltip content="Search" shortcut="mod+k">
						<Button variant="ghost" size="icon" aria-label="Search" onClick={() => setPaletteOpen(true)}>
							<MagnifyingGlassIcon />
						</Button>
					</Tooltip>
					<SidebarToggle />
				</div>
			</div>
			<WindowTabs />
		</header>
	);
}
