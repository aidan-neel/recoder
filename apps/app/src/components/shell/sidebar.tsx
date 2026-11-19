'use client';

import { Button, Keycap, Tooltip } from '@recoder/ui';
import { ArrowLeftIcon, MagnifyingGlassIcon, PlusIcon } from '@phosphor-icons/react';
import type { ReactNode } from 'react';

import { useApi } from '@/lib/api/client';
import { useIsAdmin } from '@/lib/account/use-is-admin';
import { leaveSettings, openSettings } from '@/lib/settings/open-settings';
import type { SettingsSection } from '@/lib/settings/sections';
import { useChrome } from '@/lib/shell/chrome';
import { usePathname } from '@/lib/shell/navigation';
import { newReviewHref, pullsHref, routeOf } from '@/lib/shell/routes';
import { useShell } from '@/lib/shell/use-shell';
import { useSidebarShown } from '@/lib/shell/use-sidebar-shown';

import { Link } from '@/components/common/link';
import { PanelResizer } from '@/components/common/panel-resizer';
import { SettingsNav } from '@/components/settings/settings-nav';

import { SidebarBody } from './sidebar-body';
import { SidebarFoot } from './sidebar-foot';
import { SidebarToggle } from './sidebar-toggle';

/**
 * The sidebar: search and a new review, the places, the newest reviews and chats, the tracked repositories, the
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

/** The app's sidebar: a search field that opens the palette, the button for a new review, then the lists. */
function AppSide() {
	const { base } = useApi();
	const shell = useShell();
	const setPaletteOpen = useChrome((state) => state.setPaletteOpen);

	return (
		<>
			<div className="sidebar-head">
				<Button variant="outline" className="sidebar-search" onClick={() => setPaletteOpen(true)}>
					<MagnifyingGlassIcon />
					<span className="sidebar-search-label">Search</span>
					<Keycap k="mod+k" />
				</Button>
				<Tooltip content="New review" shortcut="c">
					<Button variant="ghost" size="icon" asChild>
						<Link href={newReviewHref(base)} aria-label="New review">
							<PlusIcon />
						</Link>
					</Button>
				</Tooltip>
			</div>
			<SidebarBody shell={shell} />
		</>
	);
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
				<SidebarToggle />
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
