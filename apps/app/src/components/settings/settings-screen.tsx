'use client';

import type { ReactNode } from 'react';

import { SETTINGS_SECTIONS, type SettingsSection } from '@/lib/settings/sections';
import { settingsHref } from '@/lib/shell/routes';

import { ColumnPage } from '@/components/common/column-page';
import { PageTabs } from '@/components/common/page-tabs';
import { ConnectionsSection } from '@/components/connections/connections-section';

import { AppearanceSection } from './appearance-section';
import { LimitsSection } from './limits-section';
import { ModelsSection } from './models-section';
import { ServerSection } from './server-section';

const TABS = SETTINGS_SECTIONS.map((section) => ({
	id: section.id,
	label: section.label,
	href: settingsHref(section.id)
}));

const SECTIONS: Record<SettingsSection, () => ReactNode> = {
	models: () => <ModelsSection />,
	connections: () => <ConnectionsSection />,
	limits: () => (
		<ServerSection groups={[2, 1, 3]}>
			<LimitsSection />
		</ServerSection>
	),
	appearance: () => <AppearanceSection />
};

/** Settings: one page per section, switched by the tabs at the top of the column. */
export function SettingsScreen({ section }: { section: SettingsSection }) {
	return (
		<ColumnPage title="Settings">
			<div className="column-tabs">
				<PageTabs label="Settings" tabs={TABS} current={section} />
			</div>
			{SECTIONS[section]()}
		</ColumnPage>
	);
}
