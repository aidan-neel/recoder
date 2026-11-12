'use client';

import { HoverList, NavPill, NavPillGroup } from '@recoder/ui';
import Link from 'next/link';
import type { MouseEvent } from 'react';

import { PanelHeader } from '@/components/common/panel-header';
import { SETTINGS_SECTIONS, sectionFromPath, type SettingsSection } from '@/lib/settings/sections';
import { opensInPlace } from '@/lib/shell/routes';
import { useShell } from '@/lib/shell/shell-store';

/**
 * A plain click goes through the shell store, as the gear and `mod+,` do:
 * the section on screen stays while the new one's data is read, for about
 * 180ms at most, then the new one swaps in place through the history API,
 * which Next keeps in step with `usePathname`, so nothing reloads. A click on
 * the section on screen drops a swap still under way. Modified clicks (a new
 * tab) keep the link's own behavior; the router never goes to a section by
 * itself, so the links prefetch nothing.
 */
function swapInPlace(event: MouseEvent<HTMLAnchorElement>, href: string, current: boolean): void {
	if (!opensInPlace(event)) return;

	event.preventDefault();

	const { arriving, navigate } = useShell.getState();

	if (!current || arriving) navigate(href);
}

/** The section whose link holds the pill: the one a swap is heading to, so the pill moves at the click, else the one on screen. */
function usePillSection(active: SettingsSection): SettingsSection {
	const heading = useShell((state) => (state.arriving ? sectionFromPath(state.arriving.path) : null));

	return heading ?? active;
}

/**
 * Settings' section list. The pill slides to a new pick as it is clicked,
 * while the section it leaves stays until the new one can paint. The boot
 * frame and the page both draw this nav beside the section.
 */
export function SettingsNav({ active }: { active: SettingsSection }) {
	const pill = usePillSection(active);

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
									prefetch={false}
									aria-current={current ? 'page' : undefined}
									className="settings-nav-link"
									onClick={(event) => swapInPlace(event, href, current)}
								>
									{section.id === pill ? <NavPill value={section.id} /> : null}
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
