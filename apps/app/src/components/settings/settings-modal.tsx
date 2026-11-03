'use client';

import { Modal, ModalContent } from '@recoder/ui';
import { useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';

import type { SettingsSection } from '@/lib/settings/sections';
import { closeSettings, openSection, settingsClosed } from '@/lib/settings/settings-url';

import { SettingsPanel } from './settings-panel';

/** Opening focuses the panel, not its first control, so no focus ring lights on open; Tab reaches the section links first. */
function focusPanel(event: Event): void {
	event.preventDefault();

	if (event.currentTarget instanceof HTMLElement) event.currentTarget.focus();
}

/**
 * Settings, over whatever page is on screen. The address holds the open
 * section (`?settings=connections`), so a link, Back and Forward open and
 * close it; the gear, `mod+,`, the palette and error toasts all go through
 * `openSettings`. While it leaves, it keeps showing the section it closed on.
 */
export function SettingsModal() {
	const section = openSection(useSearchParams());
	const [last, setLast] = useState<SettingsSection>(section ?? 'agent');

	if (section && section !== last) setLast(section);

	useEffect(() => {
		if (!section) settingsClosed();
	}, [section]);

	return (
		<Modal open={section !== null} onOpenChange={(open) => (open ? undefined : closeSettings())}>
			<ModalContent showClose={false} size="xl" className="settings-modal" onOpenAutoFocus={focusPanel}>
				<SettingsPanel active={section ?? last} />
			</ModalContent>
		</Modal>
	);
}
