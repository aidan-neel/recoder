'use client';

import { HoverList, Input, RowButton } from '@recoder/ui';
import {
	PulseIcon,
	SquaresFourIcon,
	ChartBarIcon,
	CpuIcon,
	GaugeIcon,
	LinkSimpleIcon,
	PaletteIcon,
	MagnifyingGlassIcon,
	UserGearIcon,
	type Icon
} from '@phosphor-icons/react';
import { useState, type KeyboardEvent } from 'react';

import { matchSections, sectionsFor, type SettingsSection } from '@/lib/settings/sections';

const ICONS: Record<SettingsSection, Icon> = {
	models: CpuIcon,
	providers: SquaresFourIcon,
	connections: LinkSimpleIcon,
	limits: GaugeIcon,
	usage: ChartBarIcon,
	telemetry: PulseIcon,
	admin: UserGearIcon,
	appearance: PaletteIcon
};

interface SettingsNavProps {
	active: SettingsSection;
	admin: boolean;
	onSelect: (section: SettingsSection) => void;
}

/**
 * The Settings dialog's sections, on the sidebar's lanes, under a field that
 * narrows them to the ones whose name or contents hold the words typed; Enter
 * opens the first. The open one sits on a still fill. The admin's own sections
 * run under an Admin label below the rest.
 */
export function SettingsNav({ active, admin, onSelect }: SettingsNavProps) {
	const [query, setQuery] = useState('');
	const sections = matchSections(sectionsFor(admin), query);
	const own = sections.filter((section) => !('adminOnly' in section));
	const adminOwn = sections.filter((section) => 'adminOnly' in section);

	function row({ id, label }: (typeof sections)[number]) {
		const Icon = ICONS[id];

		return (
			<RowButton
				key={id}
				data-nav
				data-active={active === id || undefined}
				aria-current={active === id ? 'page' : undefined}
				className="nav-item"
				onClick={() => onSelect(id)}
			>
				<Icon aria-hidden />
				{label}
			</RowButton>
		);
	}

	function openFirst(event: KeyboardEvent<HTMLInputElement>): void {
		const [first] = sections;

		if (event.key !== 'Enter' || !first) return;

		event.preventDefault();
		onSelect(first.id);
	}

	return (
		<nav aria-label="Settings sections" className="settings-modal-nav">
			<Input
				type="search"
				aria-label="Search settings"
				placeholder="Search"
				leading={<MagnifyingGlassIcon aria-hidden />}
				value={query}
				onChange={(event) => setQuery(event.target.value)}
				onKeyDown={openFirst}
				className="settings-nav-search"
			/>
			<HoverList className="sidebar-nav" itemSelector="[data-nav]">
				{own.map(row)}
				{adminOwn.length > 0 ? <h3 className="section-label nav-group-label">Admin</h3> : null}
				{adminOwn.map(row)}
			</HoverList>
			{sections.length === 0 ? <p className="settings-nav-empty">No settings match “{query.trim()}”.</p> : null}
		</nav>
	);
}
