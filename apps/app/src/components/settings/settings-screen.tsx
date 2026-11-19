'use client';

import { useEffect, type ReactNode } from 'react';

import { useIsAdmin } from '@/lib/account/use-is-admin';
import { canOpenSection, sectionLabel, type SettingsSection } from '@/lib/settings/sections';
import { replaceAddress } from '@/lib/shell/navigation';
import { settingsHref } from '@/lib/shell/routes';

import { AdminSection } from '@/components/admin/admin-section';
import { ConnectionsSection } from '@/components/connections/connections-section';
import { Crumbs } from '@/components/common/crumbs';
import { Page } from '@/components/common/page';

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

const SECTIONS: Record<SettingsSection, () => ReactNode> = {
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
	appearance: () => <AppearanceSection />
};

/** A control for the whole section, at the right of the bar: the range Usage and Telemetry look back over. */
function sectionEnd(section: SettingsSection): ReactNode {
	if (section === 'usage') return <UsageRange />;
	if (section === 'telemetry') return <TelemetryRange />;

	return null;
}

/**
 * A section of Settings, as a page in the tab on screen: the sections themselves take over the sidebar
 * (`SettingsSidebar`), and the tab is named for the open one. A member sent to one of the admin's sections lands on the
 * first section instead.
 */
export function SettingsScreen({ section }: { section: SettingsSection }) {
	const admin = useIsAdmin();
	const allowed = canOpenSection(section, admin);

	useEffect(() => {
		if (!allowed) replaceAddress(settingsHref());
	}, [allowed]);

	return (
		<Page
			start={<Crumbs parts={[{ label: 'Settings' }, { label: sectionLabel(section) }]} />}
			end={sectionEnd(section)}
		>
			<div key={section} className="page-scroll">
				<div className="page-column settings-page">{allowed ? SECTIONS[section]() : null}</div>
			</div>
		</Page>
	);
}
