'use client';

import type { ReactNode } from 'react';

import { useSwapFocus, type SidebarMode } from '@/lib/shell/sidebar-mode';

interface SidebarSwapProps {
	mode: SidebarMode;
	/** What the spot holds on the app's pages. */
	app: ReactNode;
	/** What it holds on Settings' pages. */
	settings: ReactNode;
	/** Places the spot in its row or column (`sidebar-swap-head`, `sidebar-swap-body`). */
	className: string;
}

/**
 * One spot of the sidebar with two layers stacked in it, the app's and
 * Settings'. Both stay mounted, so the app's lists keep their scroll and
 * coming back costs no load. The hidden one is inert; the swap fades the old
 * one out, then the new one in (`.sidebar-layer` in shell.css).
 */
export function SidebarSwap({ mode, app, settings, className }: SidebarSwapProps) {
	const { appRef, settingsRef } = useSwapFocus(mode);

	return (
		<div className={`sidebar-swap ${className}`}>
			<div ref={appRef} className="sidebar-layer" data-shown={mode === 'app'} inert={mode !== 'app'}>
				{app}
			</div>
			<div ref={settingsRef} className="sidebar-layer" data-shown={mode === 'settings'} inert={mode !== 'settings'}>
				{settings}
			</div>
		</div>
	);
}
