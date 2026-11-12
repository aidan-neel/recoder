'use client';

import { Toaster, TooltipProvider } from '@recoder/ui';
import { MotionConfig } from 'motion/react';
import { useRouter } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';

import { useApi } from '@/lib/api/client';
import { useChrome } from '@/lib/shell/chrome';
import { newReviewHref, settingsHref } from '@/lib/shell/routes';
import { followSystemTheme } from '@/lib/shell/theme';
import { useKeys } from '@/lib/shell/use-keys';

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
	const sidebarOpen = useChrome((state) => state.sidebarOpen);

	useEffect(() => followSystemTheme(), []);

	useKeys({
		'mod+k': () => useChrome.getState().setPaletteOpen(!useChrome.getState().paletteOpen),
		'mod+,': () => router.push(settingsHref()),
		'[': () => useChrome.getState().toggleSidebar(),
		c: () => router.push(newReviewHref(base)),
		'?': () => useChrome.getState().setShortcutsOpen(true)
	});

	return (
		<MotionConfig reducedMotion="user">
			<TooltipProvider>
				<div className="app-frame" data-sidebar={sidebarOpen ? 'open' : 'closed'}>
					<Sidebar model={model} />
					{children}
				</div>
				<CommandPalette />
				<ShortcutsModal />
				<Toaster />
			</TooltipProvider>
		</MotionConfig>
	);
}
