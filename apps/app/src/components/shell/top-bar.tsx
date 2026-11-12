'use client';

import { memo, useMemo, type ReactNode, type Ref } from 'react';

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

interface BarLayoutProps {
	/** The tab strip, which takes the room left over. */
	strip: ReactNode;
	/** The search trigger, pushed to the row's end. */
	search: ReactNode;
	/** The row holding the strip and the search, which the bar measures to fit its tabs. */
	rowRef?: Ref<HTMLDivElement>;
	/** Lights the gear: a settings page shows (not the 404 of an unknown section). */
	settings: boolean;
}

/**
 * Where the bar's pieces sit: the tab strip, the search trigger at the end of
 * its row, then the settings gear. The boot frame lays out its bar with it
 * too, so the interactive bar lands on the same pixels. It renders again only
 * when a piece changes.
 */
export const BarLayout = memo(function BarLayout({ strip, search, rowRef, settings }: BarLayoutProps) {
	return (
		<>
			<div ref={rowRef} className="flex h-full min-w-0 flex-1 items-center gap-1.5">
				{strip}
				{search}
			</div>
			<SettingsButton href={SETTINGS_HREF} active={settings} />
		</>
	);
});

/**
 * What the top bar holds: Queue, then one tab per open review, then search
 * and the settings gear. No logo. `ShellFrame` draws the bar around it. It
 * reads the page from the shell store, so it renders when the page changes,
 * not on every address write. The strip and the search keep their elements
 * while the fit stays the same, so a measure that changes nothing renders
 * nothing below the bar.
 */
export function TopBar() {
	const pathname = useShell((state) => state.pathname);
	const heading = useShell((state) => state.heading);
	const active = heading ?? activeTab(pathname);
	const { rowRef, rulerRef, fit, opening } = useTabFit(active);
	const size = fit?.search;

	const strip = useMemo(
		() => <TabStrip active={active} fit={fit} opening={opening} rulerRef={rulerRef} />,
		[active, fit, opening, rulerRef]
	);

	const search = useMemo(() => <SearchButton size={size} onClick={openPalette} />, [size]);

	return <BarLayout rowRef={rowRef} settings={onSettings(pathname)} strip={strip} search={search} />;
}
