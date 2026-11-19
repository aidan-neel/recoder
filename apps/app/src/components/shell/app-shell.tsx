'use client';

import { SkeletonProvider, Toaster, TooltipProvider } from '@recoder/ui';
import { MotionConfig } from 'motion/react';
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type TransitionEvent } from 'react';

import { useApi } from '@/lib/api/client';
import { leaveSettings, openSettings } from '@/lib/settings/open-settings';
import { useChrome } from '@/lib/shell/chrome';
import {
	closeTabs,
	markOpeningEntry,
	navigate,
	openTab,
	reopenTab,
	startWindowTabs,
	stepTab,
	switchTab,
	usePathname
} from '@/lib/shell/navigation';
import { inSettings, isLiveApp, newReviewHref, pullsHref } from '@/lib/shell/routes';
import { toggleSidebar } from '@/lib/shell/sidebar-toggle';
import { useTabs } from '@/lib/shell/tabs';
import { followSystemTheme } from '@/lib/shell/theme';
import { useKeys } from '@/lib/shell/use-keys';

import { CommandPalette } from './command-palette';
import { ShortcutsModal } from './shortcuts-modal';
import { Sidebar } from './sidebar';
import { Topbar } from './topbar';

interface AppShellProps {
	/** The model chip at the foot of the sidebar: the live one reads Settings, the sample's is fixed. */
	model: ReactNode;
	children: ReactNode;
}

/** Brings the tab `offset` places along the row to the screen, wrapping round at either end. */
function cycleTab(offset: number): void {
	const { tabs, activeId } = useTabs.getState();
	const index = tabs.findIndex((tab) => tab.id === activeId);

	switchTab(tabs[(index + offset + tabs.length) % tabs.length].id);
}

/** `alt+1`…`alt+8` bring that tab to the screen and `alt+9` the last, as a browser's own tabs do. */
function ordinalKeys(): Record<string, () => void> {
	const keys: Record<string, () => void> = {};

	for (let place = 1; place <= 9; place++) {
		keys[`alt+${place}`] = () => {
			const { tabs } = useTabs.getState();
			const tab = place === 9 ? tabs[tabs.length - 1] : tabs[place - 1];

			if (tab) switchTab(tab.id);
		};
	}

	return keys;
}

/**
 * The frame every page sits in: a link past the chrome for keyboard users,
 * the topbar with the window's tabs, the sidebar, the page beside it, and the
 * app-wide overlays. It owns the keys that work anywhere. The browser keeps
 * Cmd/Ctrl with T, W, 1–9 and Tab for its own tabs, so the window's tabs
 * answer to Alt (Option) instead.
 */
export function AppShell({ model, children }: AppShellProps) {
	const { base } = useApi();

	useState(startWindowTabs);
	useEffect(markOpeningEntry, []);
	useEffect(() => followSystemTheme(), []);

	useKeys({
		'mod+k': () => useChrome.getState().setPaletteOpen(!useChrome.getState().paletteOpen),
		'mod+,': () => (isLiveApp(base) ? toggleSettings(base) : false),
		'mod+b': () => toggleSidebar(),
		'[': () => toggleSidebar(),
		'mod+[': () => stepTab(-1),
		'mod+]': () => stepTab(1),
		'alt+t': () => openTab(newReviewHref(base)),
		'alt+w': () => closeTabs([useTabs.getState().activeId], pullsHref(base)),
		'alt+shift+t': () => reopenTab(),
		'alt+[': () => cycleTab(-1),
		'alt+]': () => cycleTab(1),
		...ordinalKeys(),
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
						<Topbar />
						<Sidebar model={model} />
						{children}
					</Frame>
					<CommandPalette />
					<ShortcutsModal />
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
 * A toggle marks the frame `data-sliding` until the slide ends, so the page
 * holds one width through it (shell.css); the first render does not slide.
 */
function Frame({ children }: { children: ReactNode }) {
	const sidebarOpen = useChrome((state) => state.sidebarOpen);
	const drawerOpen = useChrome((state) => state.drawerOpen);
	const setDrawerOpen = useChrome((state) => state.setDrawerOpen);
	const pathname = usePathname();
	const frame = useRef<HTMLDivElement>(null);
	const slidFrom = useRef(sidebarOpen);
	const [sliding, setSliding] = useState(false);

	useEffect(() => setDrawerOpen(false), [pathname, setDrawerOpen]);

	useLayoutEffect(() => {
		if (slidFrom.current === sidebarOpen || !frame.current) return;

		slidFrom.current = sidebarOpen;

		if (getComputedStyle(frame.current).transitionProperty !== 'none') setSliding(true);
	}, [sidebarOpen]);

	/** The slide is over when it ends, or when it is cut short with nothing taking its place (a window gone narrow). */
	function onSlideStop(event: TransitionEvent<HTMLDivElement>): void {
		if (event.target !== event.currentTarget || event.propertyName !== 'grid-template-columns') return;

		if (event.type === 'transitionend' || event.currentTarget.getAnimations().length === 0) setSliding(false);
	}

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
			ref={frame}
			className="app-frame"
			data-sidebar={sidebarOpen ? 'open' : 'closed'}
			data-drawer={drawerOpen ? 'open' : undefined}
			data-sliding={sliding || undefined}
			onTransitionEnd={onSlideStop}
			onTransitionCancel={onSlideStop}
		>
			{children}
			<div className="sidebar-scrim" aria-hidden onClick={() => setDrawerOpen(false)} />
		</div>
	);
}

/** ⌘, opens Settings in the tab on screen, and from Settings goes back to the page it opened over. */
function toggleSettings(base: string): void {
	if (inSettings(window.location.pathname)) leaveSettings(pullsHref(base));
	else openSettings();
}
