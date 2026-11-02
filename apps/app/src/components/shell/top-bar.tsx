'use client';

import { usePathname, useSearchParams } from 'next/navigation';
import { useEffect } from 'react';

import { openSection, openSettings } from '@/lib/settings/settings-url';
import { activeTab } from '@/lib/shell/routes';
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
 * and the settings gear, lit while settings is open. No logo. `ShellFrame` draws the bar around it.
 */
export function TopBar() {
	const pathname = usePathname();
	const settingsOpen = openSection(useSearchParams()) !== null;
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
			<SettingsButton onOpen={() => openSettings()} active={settingsOpen} />
		</>
	);
}
