'use client';

import { usePathname } from 'next/navigation';
import { useEffect } from 'react';

import { activeTab, onSettings, SETTINGS_HREF } from '@/lib/shell/routes';
import { useShell } from '@/lib/shell/shell-store';

import { SearchButton } from './search-button';
import { SettingsButton } from './settings-button';
import { TabStrip } from './tab-strip';
import { useTabFit } from './use-tab-fit';

/** Opens the palette. */
function openPalette(): void {
	useShell.getState().setPaletteOpen(true);
}

/**
 * What the top bar holds: Queue, then one tab per open review, then search
 * and the settings gear, lit while a settings page shows (not on the 404 of
 * an unknown section). No logo. `ShellFrame` draws the bar around it.
 */
export function TopBar() {
	const pathname = usePathname();
	const heading = useShell((state) => state.heading);
	const active = heading ?? activeTab(pathname);
	const { rowRef, rulerRef, fit } = useTabFit(active);

	useEffect(() => useShell.getState().setHeading(null), [pathname]);

	return (
		<>
			<div ref={rowRef} className="flex h-full min-w-0 flex-1 items-center gap-1.5">
				<TabStrip active={active} fit={fit} rulerRef={rulerRef} />
				<SearchButton compact={fit?.compact} onClick={openPalette} />
			</div>
			<SettingsButton href={SETTINGS_HREF} active={onSettings(pathname)} />
		</>
	);
}
