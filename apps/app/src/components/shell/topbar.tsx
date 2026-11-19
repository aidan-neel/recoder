'use client';

import { useStore } from 'zustand';

import { useListStore } from '@/lib/api/client';

import { AccountMenu } from './account-menu';
import { SidebarToggle } from './sidebar-toggle';
import { WindowTabs } from './window-tabs';

/**
 * The bar across the top of the window. Over the sidebar: the account and the sidebar's toggle, so the top-left is
 * never empty. Beside them, from the page's left edge, the window's tabs and the + that starts a new review. Back and
 * Forward have no buttons: ⌘[ and ⌘] and the browser's own walk the tab on screen.
 */
export function Topbar() {
	const { state } = useListStore();
	const account = useStore(state, (data) => data.account);

	return (
		<header className="topbar" data-chrome>
			<div className="topbar-lead">
				<AccountMenu account={account} />
				<SidebarToggle />
			</div>
			<WindowTabs />
		</header>
	);
}
