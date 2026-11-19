'use client';

import { useEffect, type ReactNode } from 'react';

import { useIsAdmin } from '@/lib/account/use-is-admin';
import { canOpenSection, sectionLabel, type SettingsSection } from '@/lib/settings/sections';
import { replaceAddress } from '@/lib/shell/navigation';
import { settingsHref } from '@/lib/shell/routes';

import type { ServerView } from '@/lib/server/server-views';

import { AdminSection } from '@/components/admin/admin-section';
import { ConnectionsSection } from '@/components/connections/connections-section';
import { Crumbs } from '@/components/common/crumbs';
import { Page } from '@/components/common/page';
import { ServerSettings, ServerViews } from '@/components/server/server-settings';

import { AdminControls } from './admin-controls';
import { AppearanceSection } from './appearance-section';
import { LimitsSection } from './limits-section';
import { ModelsSection } from './models-section';
import { ProvidersSection } from './providers/providers-section';
import { ServerSection } from './server-section';
import { TelemetryRange } from './telemetry/telemetry-range';
import { TelemetrySection } from './telemetry/telemetry-section';
import { UsageRange } from './usage/usage-range';
import { UsageSection } from './usage/usage-section';

const SECTIONS: Record<SettingsSection, (view: ServerView) => ReactNode> = {
	models: () => <ModelsSection />,
	providers: () => (
		<AdminControls>
			<ProvidersSection />
		</AdminControls>
	),
	connections: () => <ConnectionsSection />,
	limits: () => (
		<ServerSection groups={[2, 1, 3]}>
			<LimitsSection />
		</ServerSection>
	),
	usage: () => <UsageSection />,
	telemetry: () => <TelemetrySection />,
	admin: () => <AdminSection />,
	server: (view) => <ServerSettings view={view} />,
	appearance: () => <AppearanceSection />
};

/** A control for the whole section, at the right of the bar: the range Usage and Telemetry look back over, Server's views. */
function sectionEnd(section: SettingsSection, view: ServerView): ReactNode {
	if (section === 'server') return <ServerViews view={view} />;
	if (section === 'usage') return <UsageRange />;
	if (section === 'telemetry') return <TelemetryRange />;

	return null;
}

/**
 * A section of Settings, as a page in the tab on screen: the sections themselves take over the sidebar
 * (`SettingsSidebar`), and the tab is named for the open one. A member sent to one of the admin's sections lands on the
 * first section instead.
 */
export function SettingsScreen({ section, view }: { section: SettingsSection; view: ServerView | null }) {
	const shown = view ?? 'overview';
	const admin = useIsAdmin();
	const allowed = canOpenSection(section, admin);

	useEffect(() => {
		if (!allowed) replaceAddress(settingsHref());
	}, [allowed]);

	return (
		<Page
			start={<Crumbs parts={[{ label: 'Settings' }, { label: sectionLabel(section) }]} />}
			end={sectionEnd(section, shown)}
		>
			<div key={`${section}/${shown}`} className="page-scroll">
				<div className="page-column settings-page" data-view={section === 'server' ? shown : undefined}>
					{allowed ? SECTIONS[section](shown) : null}
				</div>
			</div>
		</Page>
	);
}
