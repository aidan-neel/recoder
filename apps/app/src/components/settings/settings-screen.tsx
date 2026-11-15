'use client';

import type { ReactNode } from 'react';

import { useIsAdmin } from '@/lib/account/use-is-admin';
import { canOpenSection, sectionLabel, type SettingsSection } from '@/lib/settings/sections';

import { AdminSection } from '@/components/admin/admin-section';
import { PageMissing } from '@/components/common/page-missing';
import { ConnectionsSection } from '@/components/connections/connections-section';

import { AdminControls } from './admin-controls';
import { AppearanceSection } from './appearance-section';
import { LimitsSection } from './limits-section';
import { ModelsSection } from './models-section';
import { ProvidersSection } from './providers/providers-section';
import { ServerSection } from './server-section';
import { SettingsPage } from './settings-page';
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

function sectionEnd(section: SettingsSection): ReactNode {
	if (section === 'usage') return <UsageRange />;
	if (section === 'telemetry') return <TelemetryRange />;

	return undefined;
}

/**
 * Settings: one page per section, picked in the sidebar, its name over the
 * column. A section the person may not open is a missing page.
 */
export function SettingsScreen({ section }: { section: SettingsSection }) {
	const admin = useIsAdmin();

	if (!canOpenSection(section, admin)) return <PageMissing />;

	return (
		<SettingsPage name="Settings" heading={sectionLabel(section)} end={sectionEnd(section)}>
			{SECTIONS[section]()}
		</SettingsPage>
	);
}
