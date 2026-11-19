'use client';

import { Button, Tooltip } from '@recoder/ui';
import { ArrowLeftIcon } from '@phosphor-icons/react';
import type { ReactNode } from 'react';

import { useApi } from '@/lib/api/client';
import { useIsAdmin } from '@/lib/account/use-is-admin';
import { leaveSettings, openSettings } from '@/lib/settings/open-settings';
import type { SettingsSection } from '@/lib/settings/sections';
import { usePathname } from '@/lib/shell/navigation';
import { pullsHref, routeOf } from '@/lib/shell/routes';
import { useShell } from '@/lib/shell/use-shell';
import { useSidebarShown } from '@/lib/shell/use-sidebar-shown';

import { PanelResizer } from '@/components/common/panel-resizer';
import { SettingsNav } from '@/components/settings/settings-nav';

import { SidebarBody } from './sidebar-body';
import { SidebarFoot } from './sidebar-foot';

/**
 * The sidebar: search, the places, the newest reviews and chats, the tracked repositories, the
 * settled ones at the bottom, and the model in use. On a page of Settings, Settings' own sections take its place
 * under a way back. Hidden, it stays mounted and inert, so bringing it back costs no load and its lists keep their
 * scroll.
 */
export function Sidebar({ model }: { model: ReactNode }) {
	const { base } = useApi();
	const route = routeOf(usePathname(), base);

	return (
		<SidebarPanel>
			{route.screen === 'settings' ? <SettingsSide section={route.section} /> : <AppSide />}
			<SidebarFoot model={model} />
		</SidebarPanel>
	);
}

/** The app's sidebar: search and the places, then the lists. A new review starts from the + after the tabs. */
function AppSide() {
	const shell = useShell();

	return <SidebarBody shell={shell} />;
}

/** Settings' sidebar: back to the page Settings opened over, then the sections under their search. */
function SettingsSide({ section }: { section: SettingsSection }) {
	const admin = useIsAdmin();

	return (
		<>
			<div className="sidebar-head">
				<Tooltip content="Back to the app" shortcut="mod+,">
					<Button variant="ghost" className="settings-back" onClick={() => leaveSettings(pullsHref(''))}>
						<ArrowLeftIcon />
						Settings
					</Button>
				</Tooltip>
			</div>
			<SettingsNav active={section} admin={admin} onSelect={openSettings} />
		</>
	);
}

/**
 * The sidebar's box, inert while hidden: a column beside the page, or on a narrow window a drawer over it. It alone follows the open state, so
 * a toggle re-renders it and nothing inside it.
 */
function SidebarPanel({ children }: { children: ReactNode }) {
	const open = useSidebarShown();

	return (
		<aside className="sidebar" aria-label="Recoder" inert={!open} data-chrome>
			{children}
			<PanelResizer panel="sidebar" label="Resize sidebar" />
		</aside>
	);
}
