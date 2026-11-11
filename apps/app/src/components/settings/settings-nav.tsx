'use client';

import { HoverList, ModalTitle, NavPill, NavPillGroup } from '@recoder/ui';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import type { MouseEvent } from 'react';

import { PanelHeader } from '@/components/common/panel-header';
import { SETTINGS_SECTIONS, type SettingsSection } from '@/lib/settings/sections';
import { openSettings, settingsHref } from '@/lib/settings/settings-url';

/**
 * A plain click swaps the section in place: the address changes through the
 * history API, which Next keeps in step with `useSearchParams`, so nothing
 * reloads. Modified clicks (a new tab) keep the link's own behavior.
 */
function swapInPlace(event: MouseEvent<HTMLAnchorElement>, section: SettingsSection, active: boolean): void {
	if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

	event.preventDefault();

	if (!active) openSettings(section);
}

/** Settings' section list, under the modal's title. The active section's pill slides to a new pick. */
export function SettingsNav({ active }: { active: SettingsSection }) {
	const place = { pathname: usePathname(), search: useSearchParams().toString() };

	return (
		<nav aria-label="Settings sections" className="settings-nav">
			<PanelHeader>
				<ModalTitle className="settings-nav-title">Settings</ModalTitle>
			</PanelHeader>
			<NavPillGroup>
				<HoverList as="ul" itemSelector="a" className="settings-nav-list" highlightClassName="rounded-[8px]">
					{SETTINGS_SECTIONS.map((section) => {
						const current = section.id === active;

						return (
							<li key={section.id}>
								<Link
									href={settingsHref(section.id, place)}
									aria-current={current ? 'page' : undefined}
									className="settings-nav-link"
									onClick={(event) => swapInPlace(event, section.id, current)}
								>
									{current ? <NavPill value={section.id} /> : null}
									{section.label}
								</Link>
							</li>
						);
					})}
				</HoverList>
			</NavPillGroup>
		</nav>
	);
}
