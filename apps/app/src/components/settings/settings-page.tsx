'use client';

import { ScrollArea } from '@recoder/ui';
import { usePathname } from 'next/navigation';
import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react';

import { PanelHeader } from '@/components/common/panel-header';
import { ConnectionsSection } from '@/components/connections/connections-section';
import { GuidelinesSection } from '@/components/guidelines/guidelines-section';
import { SETTINGS_SECTIONS, sectionFromPath, sectionTitle, type SettingsSection } from '@/lib/settings/sections';

import { AgentSection } from './agent-section';
import { AppearanceSection } from './appearance-section';
import { HarnessSection } from './harness-section';
import { SettingsNav } from './settings-nav';

/** Each section loads only what it shows and paints once all of it has answered; each group fails and retries on its own. */
function SectionBody({ section }: { section: SettingsSection }) {
	if (section === 'agent') return <AgentSection />;
	if (section === 'harness') return <HarnessSection />;
	if (section === 'connections') return <ConnectionsSection />;
	if (section === 'guidelines') return <GuidelinesSection />;

	return <AppearanceSection />;
}

/**
 * Starts a section swapped in place at the top. A fresh page is at the top
 * already, so the first section skips the reset: a `scrollTo` in the mount
 * commit forces a full layout before the first paint.
 */
function useTopOnSwap(active: SettingsSection): RefObject<HTMLDivElement | null> {
	const viewport = useRef<HTMLDivElement>(null);
	const shown = useRef(active);

	useLayoutEffect(() => {
		if (shown.current === active) return;

		shown.current = active;
		viewport.current?.scrollTo({ top: 0 });
	}, [active]);

	return viewport;
}

/**
 * Settings: the section nav on the left, the open section on the right under
 * its title; a narrow window stacks the nav above the section. Switching
 * sections swaps them in place, without a page load, and starts the new one
 * at the top. The swap is one paint with no entrance: the old section and
 * title leave in the same commit the new ones arrive, and only the nav pill
 * moves. The browser tab follows, since a swap in place runs no route
 * metadata.
 */
export function SettingsPage({ section }: { section: SettingsSection }) {
	const active = sectionFromPath(usePathname()) ?? section;
	const title = SETTINGS_SECTIONS.find((item) => item.id === active)?.label;
	const viewport = useTopOnSwap(active);

	useEffect(() => {
		document.title = `${sectionTitle(active)} · Recoder`;
	}, [active]);

	return (
		<div data-ui="settings-page" className="settings-page">
			<SettingsNav active={active} />
			<div className="settings-main">
				<PanelHeader className="px-6">
					<h1 className="settings-title">{title}</h1>
				</PanelHeader>
				<ScrollArea className="min-h-0 flex-1" viewportRef={viewport}>
					<div className="settings-column">
						<SectionBody section={active} />
					</div>
				</ScrollArea>
			</div>
		</div>
	);
}
