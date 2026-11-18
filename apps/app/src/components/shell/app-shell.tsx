'use client';

import { SkeletonProvider, Toaster, TooltipProvider } from '@recoder/ui';
import { MotionConfig } from 'motion/react';
import { useEffect, type ReactNode } from 'react';

import { useApi } from '@/lib/api/client';
import { useChrome } from '@/lib/shell/chrome';
import { isLiveApp, newReviewHref } from '@/lib/shell/routes';
import { toggleSidebar } from '@/lib/shell/sidebar-toggle';
import { followSystemTheme } from '@/lib/shell/theme';
import { useKeys } from '@/lib/shell/use-keys';
import { navigate, usePathname } from '@/lib/shell/navigation';

import { SettingsModal } from '@/components/settings/settings-modal';

import { CommandPalette } from './command-palette';
import { ShortcutsModal } from './shortcuts-modal';
import { Sidebar } from './sidebar';

interface AppShellProps {
	/** The model chip at the foot of the sidebar: the live one reads Settings, the sample's is fixed. */
	model: ReactNode;
	children: ReactNode;
}

/**
 * The frame every page sits in: a link past the sidebar for keyboard users,
 * the sidebar, the page beside it, and the app-wide overlays. It owns the
 * keys that work anywhere.
 */
export function AppShell({ model, children }: AppShellProps) {
	const { base } = useApi();

	useEffect(() => followSystemTheme(), []);

	useKeys({
		'mod+k': () => useChrome.getState().setPaletteOpen(!useChrome.getState().paletteOpen),
		'mod+,': () => (isLiveApp(base) ? toggleSettings() : false),
		'[': () => toggleSidebar(),
		c: () => navigate(newReviewHref(base)),
		'?': () => useChrome.getState().setShortcutsOpen(true)
	});

	return (
		<MotionConfig reducedMotion="user">
			<SkeletonProvider>
				<TooltipProvider>
					<a href="#page" className="skip-link">
						Skip to content
					</a>
					<Frame>
						<Sidebar model={model} />
						{children}
					</Frame>
					<CommandPalette />
					<ShortcutsModal />
					<SettingsModal />
					<Toaster />
				</TooltipProvider>
			</SkeletonProvider>
		</MotionConfig>
	);
}

/**
 * The grid the sidebar slides in. It alone follows the open state, so a
 * toggle re-renders this one element and not the sidebar, the page or the
 * overlays: the slide starts on the next frame instead of after a render.
 * On a narrow window the sidebar is a drawer over the page (`data-drawer`,
 * narrow.css): a press on the scrim, Escape or going to another page shuts it.
 */
function Frame({ children }: { children: ReactNode }) {
	const sidebarOpen = useChrome((state) => state.sidebarOpen);
	const drawerOpen = useChrome((state) => state.drawerOpen);
	const setDrawerOpen = useChrome((state) => state.setDrawerOpen);
	const pathname = usePathname();

	useEffect(() => setDrawerOpen(false), [pathname, setDrawerOpen]);

	useEffect(() => {
		if (!drawerOpen) return;

		/** Escape shuts the drawer, as it does any surface that opens over the page. */
		function onKeyDown(event: KeyboardEvent): void {
			if (event.key === 'Escape') setDrawerOpen(false);
		}

		window.addEventListener('keydown', onKeyDown);

		return () => window.removeEventListener('keydown', onKeyDown);
	}, [drawerOpen, setDrawerOpen]);

	return (
		<div
			className="app-frame"
			data-sidebar={sidebarOpen ? 'open' : 'closed'}
			data-drawer={drawerOpen ? 'open' : undefined}
		>
			{children}
			<div className="sidebar-scrim" aria-hidden onClick={() => setDrawerOpen(false)} />
		</div>
	);
}

/** ⌘, opens Settings on its first section, and closes it when it is open. */
function toggleSettings(): void {
	const chrome = useChrome.getState();

	if (chrome.settingsSection === null) chrome.openSettings();
	else chrome.closeSettings();
}
