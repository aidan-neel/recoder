'use client';

import { Toaster, TooltipProvider } from '@recoder/ui';
import { MotionConfig } from 'motion/react';
import { useRouter } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';

import { useApi } from '@/lib/api/client';
import { useChrome } from '@/lib/shell/chrome';
import { newReviewHref, settingsHref } from '@/lib/shell/routes';
import { toggleSidebar } from '@/lib/shell/sidebar-toggle';
import { followSystemTheme } from '@/lib/shell/theme';
import { useKeys } from '@/lib/shell/use-keys';
import { useNavigator } from '@/lib/shell/navigation';

import { CommandPalette } from './command-palette';
import { ShortcutsModal } from './shortcuts-modal';
import { Sidebar } from './sidebar';

interface AppShellProps {
	/** The model chip at the foot of the sidebar: the live one reads Settings, the sample's is fixed. */
	model: ReactNode;
	children: ReactNode;
}

/**
 * The frame every page sits in: the sidebar, the page beside it, and the two
 * app-wide overlays. It owns the keys that work anywhere.
 */
export function AppShell({ model, children }: AppShellProps) {
	const router = useRouter();
	const { base } = useApi();

	useNavigator();
	useEffect(() => followSystemTheme(), []);

	useKeys({
		'mod+k': () => useChrome.getState().setPaletteOpen(!useChrome.getState().paletteOpen),
		'mod+,': () => router.push(settingsHref()),
		'[': () => toggleSidebar(),
		c: () => router.push(newReviewHref(base)),
		'?': () => useChrome.getState().setShortcutsOpen(true)
	});

	return (
		<MotionConfig reducedMotion="user">
			<TooltipProvider>
				<Frame>
					<Sidebar model={model} />
					{children}
				</Frame>
				<CommandPalette />
				<ShortcutsModal />
				<Toaster />
			</TooltipProvider>
		</MotionConfig>
	);
}

/**
 * The grid the sidebar slides in. It alone follows the open state, so a
 * toggle re-renders this one element and not the sidebar, the page or the
 * overlays: the slide starts on the next frame instead of after a render.
 */
function Frame({ children }: { children: ReactNode }) {
	const sidebarOpen = useChrome((state) => state.sidebarOpen);

	return (
		<div className="app-frame" data-sidebar={sidebarOpen ? 'open' : 'closed'}>
			{children}
		</div>
	);
}
