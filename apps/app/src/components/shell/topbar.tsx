'use client';

import { Button, Tooltip } from '@recoder/ui';
import { CaretLeftIcon, CaretRightIcon } from '@phosphor-icons/react';
import { useStore } from 'zustand';

import { useListStore } from '@/lib/api/client';
import { stepTab } from '@/lib/shell/navigation';
import { activeTab, useTabs } from '@/lib/shell/tabs';

import { AccountMenu } from './account-menu';
import { SidebarToggle } from './sidebar-toggle';
import { WindowTabs } from './window-tabs';

/**
 * The bar across the top of the window. Over the sidebar: the account, the sidebar's toggle, and Back and Forward
 * through the tab on screen. Beside them, the window's tabs. With the sidebar hidden the part over it closes up to
 * what it holds, so the tabs start right after.
 */
export function Topbar() {
	const { state } = useListStore();
	const account = useStore(state, (data) => data.account);
	const canGoBack = useTabs((tabs) => activeTab(tabs).index > 0);

	const canGoForward = useTabs((tabs) => {
		const tab = activeTab(tabs);

		return tab.index < tab.entries.length - 1;
	});

	return (
		<header className="topbar" data-chrome>
			<div className="topbar-lead">
				<AccountMenu account={account} />
				<SidebarToggle />
				<Tooltip content="Back" shortcut="mod+[">
					<Button variant="ghost" size="icon" aria-label="Back" disabled={!canGoBack} onClick={() => stepTab(-1)}>
						<CaretLeftIcon />
					</Button>
				</Tooltip>
				<Tooltip content="Forward" shortcut="mod+]">
					<Button variant="ghost" size="icon" aria-label="Forward" disabled={!canGoForward} onClick={() => stepTab(1)}>
						<CaretRightIcon />
					</Button>
				</Tooltip>
			</div>
			<WindowTabs />
		</header>
	);
}
