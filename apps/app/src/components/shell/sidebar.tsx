'use client';

import { Button, Tooltip } from '@recoder/ui';
import { PanelLeft, Search } from 'lucide-react';
import type { ReactNode } from 'react';

import { useChrome } from '@/lib/shell/chrome';
import { useSidebarMode } from '@/lib/shell/sidebar-mode';
import { toggleSidebar } from '@/lib/shell/sidebar-toggle';
import { useShell } from '@/lib/shell/use-shell';

import { PanelResizer } from '@/components/common/panel-resizer';

import { AccountMenu } from './account-menu';
import { RecentActionsHost } from './recent-actions';
import { RecentChats } from './recent-chats';
import { RecentReviews } from './recent-reviews';
import { BackToApp, SettingsNav } from './settings-nav';
import { SettledReviews } from './settled-reviews';
import { SidebarFoot } from './sidebar-foot';
import { SidebarNav } from './sidebar-nav';
import { SidebarSwap } from './sidebar-swap';

/**
 * The sidebar: the account, the four places, the newest chats and reviews,
 * the settled reviews at the bottom, and the model in use. On Settings' pages the account row becomes Back to app and the
 * places and lists become Settings' sections. Hidden, it stays mounted and
 * inert, so bringing it back costs no load and its lists keep their scroll.
 */
export function Sidebar({ model }: { model: ReactNode }) {
	const shell = useShell();
	const mode = useSidebarMode();
	const setPaletteOpen = useChrome((state) => state.setPaletteOpen);

	return (
		<SidebarPanel>
			<div className="sidebar-head">
				<SidebarSwap
					mode={mode}
					className="sidebar-swap-head"
					app={<AccountMenu account={shell.account} />}
					settings={<BackToApp />}
				/>
				<Tooltip content="Search" shortcut="mod+k">
					<Button variant="ghost" size="icon" aria-label="Search" onClick={() => setPaletteOpen(true)}>
						<Search />
					</Button>
				</Tooltip>
				<Tooltip content="Hide sidebar" shortcut="[">
					<Button variant="ghost" size="icon" aria-label="Hide sidebar" data-sidebar-toggle onClick={toggleSidebar}>
						<PanelLeft />
					</Button>
				</Tooltip>
			</div>
			<SidebarSwap
				mode={mode}
				className="sidebar-swap-body"
				app={
					<>
						<SidebarNav openPulls={shell.openPulls} />
						<RecentActionsHost>
							<RecentChats chats={shell.chats} />
							<RecentReviews reviews={shell.recent} loading={shell.loading} />
							<SettledReviews reviews={shell.settled} />
						</RecentActionsHost>
					</>
				}
				settings={<SettingsNav />}
			/>
			<SidebarFoot model={model} />
		</SidebarPanel>
	);
}

/**
 * The sidebar's box, inert while hidden. It alone follows the open state, so
 * a toggle re-renders it and nothing inside it.
 */
function SidebarPanel({ children }: { children: ReactNode }) {
	const open = useChrome((state) => state.sidebarOpen);

	return (
		<aside className="sidebar" aria-label="Recoder" inert={!open} data-sidebar-part="panel" data-chrome>
			{children}
			<PanelResizer panel="sidebar" label="Resize sidebar" />
		</aside>
	);
}
