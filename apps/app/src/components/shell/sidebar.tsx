'use client';

import { Button, Tooltip } from '@recoder/ui';
import { PanelLeft, Search } from 'lucide-react';
import type { ReactNode } from 'react';

import { useChrome } from '@/lib/shell/chrome';
import { useShell } from '@/lib/shell/use-shell';

import { AccountMenu } from './account-menu';
import { RecentReviews } from './recent-reviews';
import { SidebarFoot } from './sidebar-foot';
import { SidebarNav } from './sidebar-nav';

/**
 * The sidebar: the account, the four places, the newest reviews and the model
 * in use. Hidden, it stays mounted and inert, so bringing it back costs no
 * load and its lists keep their scroll.
 */
export function Sidebar({ model }: { model: ReactNode }) {
	const shell = useShell();
	const open = useChrome((state) => state.sidebarOpen);
	const toggle = useChrome((state) => state.toggleSidebar);
	const setPaletteOpen = useChrome((state) => state.setPaletteOpen);

	return (
		<aside className="sidebar" aria-label="Recoder" inert={!open} data-chrome>
			<div className="sidebar-head">
				<AccountMenu account={shell.account} />
				<Tooltip content="Search" shortcut="mod+k">
					<Button variant="ghost" size="icon" aria-label="Search" onClick={() => setPaletteOpen(true)}>
						<Search />
					</Button>
				</Tooltip>
				<Tooltip content="Hide sidebar" shortcut="[">
					<Button variant="ghost" size="icon" aria-label="Hide sidebar" onClick={toggle}>
						<PanelLeft />
					</Button>
				</Tooltip>
			</div>
			<SidebarNav openPulls={shell.openPulls} />
			<RecentReviews reviews={shell.recent} loading={shell.loading} offline={shell.offline} />
			<SidebarFoot model={model} />
		</aside>
	);
}
