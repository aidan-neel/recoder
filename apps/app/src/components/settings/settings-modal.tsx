'use client';

import { Button, Modal, ModalClose, ModalContent, ModalTitle, Tooltip } from '@recoder/ui';
import { ChevronRight, X } from 'lucide-react';
import { usePathname } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';

import { useIsAdmin } from '@/lib/account/use-is-admin';
import { canOpenSection, SETTINGS_SECTIONS, sectionLabel, type SettingsSection } from '@/lib/settings/sections';
import { useChrome } from '@/lib/shell/chrome';

import { AdminSection } from '@/components/admin/admin-section';
import { ConnectionsSection } from '@/components/connections/connections-section';

import { AdminControls } from './admin-controls';
import { AppearanceSection } from './appearance-section';
import { LimitsSection } from './limits-section';
import { ModelsSection } from './models-section';
import { ProvidersSection } from './providers/providers-section';
import { ServerSection } from './server-section';
import { SettingsNav } from './settings-nav';
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

/** A control for the whole section, beside the close button: the range Usage and Telemetry look back over. */
function sectionEnd(section: SettingsSection): ReactNode {
	if (section === 'usage') return <UsageRange />;
	if (section === 'telemetry') return <TelemetryRange />;

	return null;
}

/**
 * Opening puts focus on the dialog itself rather than its first control, the
 * open section's row, so no ring lands on a row the person did not move to;
 * Tab then walks the sections.
 */
function focusDialog(event: Event): void {
	event.preventDefault();

	if (event.target instanceof HTMLElement) event.target.focus();
}

/**
 * Settings, as a dialog over whatever page is open: the sections on the left,
 * the open one on the right under a bar naming it. A member asked for one of
 * the admin's sections lands on the first section instead. A move to another
 * page (the palette, the browser's Back) closes it, so it never hides the page
 * that changed under it.
 */
export function SettingsModal() {
	const requested = useChrome((state) => state.settingsSection);
	const openSettings = useChrome((state) => state.openSettings);
	const closeSettings = useChrome((state) => state.closeSettings);
	const admin = useIsAdmin();
	const pathname = usePathname();

	useEffect(() => closeSettings(), [pathname, closeSettings]);

	const section = requested && canOpenSection(requested, admin) ? requested : SETTINGS_SECTIONS[0].id;

	return (
		<Modal open={requested !== null} onOpenChange={(open) => !open && closeSettings()}>
			<ModalContent size="screen" showClose={false} className="settings-modal" onOpenAutoFocus={focusDialog}>
				<SettingsNav active={section} admin={admin} onSelect={openSettings} />
				<div className="settings-modal-main">
					<header className="settings-modal-bar">
						<ModalTitle className="crumbs settings-modal-title">
							<span>Settings</span>
							<ChevronRight aria-hidden />
							<span className="settings-modal-section">{sectionLabel(section)}</span>
						</ModalTitle>
						<div className="settings-modal-end">
							{sectionEnd(section)}
							<Tooltip content="Close">
								<ModalClose>
									<Button variant="ghost" size="icon" aria-label="Close settings">
										<X />
									</Button>
								</ModalClose>
							</Tooltip>
						</div>
					</header>
					<div key={section} className="settings-modal-scroll">
						<div className="settings-page">{SECTIONS[section]()}</div>
					</div>
				</div>
			</ModalContent>
		</Modal>
	);
}
