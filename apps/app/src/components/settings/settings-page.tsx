'use client';

import { Button, DURATION, EASE_OUT, ScrollArea } from '@recoder/ui';
import { motion } from 'motion/react';
import { usePathname } from 'next/navigation';
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';

import { PageNotice } from '@/components/common/page-notice';
import { PanelHeader } from '@/components/common/panel-header';
import { ConnectionsSection } from '@/components/connections/connections-section';
import { GuidelinesSection } from '@/components/guidelines/guidelines-section';
import { OFFLINE_TEXT } from '@/lib/api/http';
import { SETTINGS_SECTIONS, sectionFromPath, sectionTitle, type SettingsSection } from '@/lib/settings/sections';
import { useSettings } from '@/lib/settings/settings-store';
import { useAction } from '@/lib/shell/use-action';

import { AgentModels } from './agent-models';
import { AgentSection } from './agent-section';
import { AppearanceSection } from './appearance-section';
import { HarnessSection } from './harness-section';
import { SettingsNav } from './settings-nav';
import { SettingsSkeleton } from './settings-skeleton';

/** A new section fades in over 120ms; the old one leaves at once. */
const SWAP = { duration: DURATION.overlay, ease: EASE_OUT };

/** Faded out, where a swapped-in section starts. */
const FADED = { opacity: 0 };

/** Shown, where it ends. */
const SHOWN = { opacity: 1 };

/** The whole page can't show settings: the server never answered, or answered with an error. */
function OfflineNotice() {
	const error = useSettings((state) => state.error);
	const retry = useAction();

	return (
		<PageNotice
			heading="h2"
			lead={error ? 'Settings didn’t load.' : OFFLINE_TEXT}
			rest={error ?? 'Start it, then try again.'}
		>
			<Button status={retry.status} onClick={() => retry.run(() => useSettings.getState().load())}>
				Try again
			</Button>
		</PageNotice>
	);
}

/** Sections that read the review settings: a skeleton while they load, the notice when the server is down. */
function ServerSection({ groups, children }: { groups: readonly number[]; children: ReactNode }) {
	const status = useSettings((state) => state.status);

	if (status === 'offline') return <OfflineNotice />;
	if (status !== 'ready') return <SettingsSkeleton groups={groups} />;

	return <div className="settings-stack">{children}</div>;
}

function SectionBody({ section }: { section: SettingsSection }) {
	if (section === 'agent') {
		return (
			<ServerSection groups={[3, 2, 2]}>
				<AgentSection />
				<AgentModels />
			</ServerSection>
		);
	}

	if (section === 'harness') {
		return (
			<ServerSection groups={[2, 3, 1]}>
				<HarnessSection />
			</ServerSection>
		);
	}

	if (section === 'connections') return <ConnectionsSection />;
	if (section === 'guidelines') return <GuidelinesSection />;

	return (
		<div className="settings-stack">
			<AppearanceSection />
		</div>
	);
}

/**
 * Whether the reader has switched sections since the page opened. The first
 * section paints as it is; each later one fades in.
 */
function useSwapped(active: SettingsSection): boolean {
	const [first] = useState(active);
	const [swapped, setSwapped] = useState(false);

	if (!swapped && active !== first) setSwapped(true);

	return swapped;
}

/**
 * Settings: the section nav on the left, the open section on the right under
 * its title. Switching sections swaps them in place, without a page load, and
 * starts the new one at the top. The swap is one paint: the old section and
 * title leave in the same commit the new ones arrive, then the new ones fade in.
 * The browser tab follows, since a swap in place runs no route metadata.
 */
export function SettingsPage({ section }: { section: SettingsSection }) {
	const active = sectionFromPath(usePathname()) ?? section;
	const title = SETTINGS_SECTIONS.find((item) => item.id === active)?.label;
	const viewport = useRef<HTMLDivElement>(null);
	const enter = useSwapped(active) ? FADED : false;

	useEffect(() => {
		void useSettings.getState().load();
	}, []);

	useLayoutEffect(() => {
		viewport.current?.scrollTo({ top: 0 });
	}, [active]);

	useEffect(() => {
		document.title = `${sectionTitle(active)} · Recoder`;
	}, [active]);

	return (
		<div data-ui="settings-page" className="settings-page">
			<SettingsNav active={active} />
			<div className="settings-main">
				<PanelHeader className="px-6">
					<motion.h1 key={active} initial={enter} animate={SHOWN} transition={SWAP} className="settings-title">
						{title}
					</motion.h1>
				</PanelHeader>
				<ScrollArea className="min-h-0 flex-1" viewportRef={viewport}>
					<motion.div key={active} initial={enter} animate={SHOWN} transition={SWAP} className="settings-column">
						<SectionBody section={active} />
					</motion.div>
				</ScrollArea>
			</div>
		</div>
	);
}
