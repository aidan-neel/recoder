'use client';

import { HoverList, RowButton } from '@recoder/ui';
import {
	ArrowLeft,
	Blocks,
	ChartNoAxesColumn,
	Cpu,
	Gauge,
	Link2,
	Palette,
	ShieldUser,
	type LucideIcon
} from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { useIsAdmin } from '@/lib/account/use-is-admin';
import { sectionOfPath, sectionsFor, type SettingsSection } from '@/lib/settings/sections';
import { pullsHref, settingsHref } from '@/lib/shell/routes';

const ICONS: Record<SettingsSection, LucideIcon> = {
	models: Cpu,
	providers: Blocks,
	connections: Link2,
	limits: Gauge,
	usage: ChartNoAxesColumn,
	admin: ShieldUser,
	appearance: Palette
};

/** Settings' sections, on the app nav's lanes. The open one sits on a still fill. */
export function SettingsNav() {
	const active = sectionOfPath(usePathname());
	const sections = sectionsFor(useIsAdmin());

	return (
		<nav aria-label="Settings">
			<HoverList className="sidebar-nav" itemSelector="[data-nav]">
				{sections.map(({ id, label }) => {
					const Icon = ICONS[id];

					return (
						<RowButton key={id} asChild data-nav data-active={active === id || undefined} className="nav-item">
							<Link href={settingsHref(id)} aria-current={active === id ? 'page' : undefined}>
								<Icon aria-hidden />
								{label}
							</Link>
						</RowButton>
					);
				})}
			</HoverList>
		</nav>
	);
}

/** Leaves Settings for the app's home, the pull request list, in the account row's place. */
export function BackToApp() {
	return (
		<RowButton asChild data-swap-focus className="nav-item sidebar-back">
			<Link href={pullsHref('')}>
				<ArrowLeft aria-hidden />
				Back to app
			</Link>
		</RowButton>
	);
}
