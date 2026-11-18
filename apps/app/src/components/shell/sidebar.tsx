'use client';

import { Button, Tooltip } from '@recoder/ui';
import { SidebarSimpleIcon, MagnifyingGlassIcon } from '@phosphor-icons/react';
import type { ReactNode } from 'react';

import { useChrome } from '@/lib/shell/chrome';
import { keepTooltipShutOnCarry, toggleSidebar } from '@/lib/shell/sidebar-toggle';
import { useShell } from '@/lib/shell/use-shell';
import { useSidebarShown } from '@/lib/shell/use-sidebar-shown';

import { PanelResizer } from '@/components/common/panel-resizer';

import { AccountMenu } from './account-menu';
import { SidebarBody } from './sidebar-body';
import { SidebarFoot } from './sidebar-foot';

/**
 * The sidebar: the account, the four places, the tracked repositories, the newest chats and reviews,
 * the settled reviews at the bottom, and the model in use. Hidden, it stays mounted and inert, so bringing it back costs
 * no load and its lists keep their scroll.
 */
export function Sidebar({ model }: { model: ReactNode }) {
	const shell = useShell();
	const setPaletteOpen = useChrome((state) => state.setPaletteOpen);

	return (
		<SidebarPanel>
			<div className="sidebar-head">
				<AccountMenu account={shell.account} />
				<Tooltip content="Search" shortcut="mod+k">
					<Button variant="ghost" size="icon" aria-label="Search" onClick={() => setPaletteOpen(true)}>
						<MagnifyingGlassIcon />
					</Button>
				</Tooltip>
				<Tooltip content="Hide sidebar" shortcut="[" onFocus={keepTooltipShutOnCarry}>
					<Button variant="ghost" size="icon" aria-label="Hide sidebar" data-sidebar-toggle onClick={toggleSidebar}>
						<SidebarSimpleIcon />
					</Button>
				</Tooltip>
			</div>
			<SidebarBody shell={shell} />
			<SidebarFoot model={model} />
		</SidebarPanel>
	);
}

/**
 * The sidebar's box, inert while hidden: a column beside the page, or on a narrow window a drawer over it. It alone follows the open state, so
 * a toggle re-renders it and nothing inside it.
 */
function SidebarPanel({ children }: { children: ReactNode }) {
	const open = useSidebarShown();

	return (
		<aside className="sidebar" aria-label="Recoder" inert={!open} data-sidebar-part="panel" data-chrome>
			{children}
			<PanelResizer panel="sidebar" label="Resize sidebar" />
		</aside>
	);
}
