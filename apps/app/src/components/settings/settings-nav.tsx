'use client';

import { HoverList, NavPill, NavPillGroup } from '@recoder/ui';
import Link from 'next/link';
import type { MouseEvent } from 'react';

import { PanelHeader } from '@/components/common/panel-header';
import { SETTINGS_SECTIONS, type SettingsSection } from '@/lib/settings/sections';

/**
 * A plain click swaps the section in place: the URL changes through the
 * history API, which Next keeps in step with `usePathname`, so nothing
 * reloads. Modified clicks (a new tab) keep the link's own behavior.
 */
function swapInPlace(event: MouseEvent<HTMLAnchorElement>, href: string, active: boolean): void {
	if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

	event.preventDefault();

	if (!active) window.history.pushState(null, '', href);
}

/** Settings' section list. The active section's pill slides to a new pick. */
export function SettingsNav({ active }: { active: SettingsSection }) {
	return (
		<nav aria-label="Settings" className="settings-nav">
			<PanelHeader>
				<span className="settings-nav-title">Settings</span>
			</PanelHeader>
			<NavPillGroup>
				<HoverList as="ul" itemSelector="a" className="settings-nav-list" highlightClassName="rounded-[8px]">
					{SETTINGS_SECTIONS.map((section) => {
						const href = `/settings/${section.id}`;
						const current = section.id === active;

						return (
							<li key={section.id}>
								<Link
									href={href}
									aria-current={current ? 'page' : undefined}
									className="settings-nav-link"
									onClick={(event) => swapInPlace(event, href, current)}
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
