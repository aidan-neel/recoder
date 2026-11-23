'use client';

import type { ThemeChoice } from '@recoder/shared';
import { Icon, SegmentedControl } from '@recoder/ui';
import type { ReactNode } from 'react';

import { SIDEBAR_ROWS, TYPEFACE, type SidebarRowsId } from '@/lib/appearance/choices';
import { useAppearance } from '@/lib/settings/use-appearance';

import { PalettePicker } from './palette-picker';
import { SettingsGroup, SettingsRow } from './settings-group';

const THEMES: { value: ThemeChoice; label: string; icon: ReactNode }[] = [
	{ value: 'system', label: 'System', icon: <Icon name="monitor" /> },
	{ value: 'light', label: 'Light', icon: <Icon name="light_mode" /> },
	{ value: 'dark', label: 'Dark', icon: <Icon name="dark_mode" /> }
];

const DETAIL: Record<ThemeChoice, string> = {
	system: 'Follows your device',
	light: 'Always light',
	dark: 'Always dark'
};

/** Each face's name, set in that face, so the control previews it. */
const TYPEFACES = TYPEFACE.options.map((option) => ({
	value: option.id,
	label: (
		<span className="typeface-name" data-face={option.id}>
			{option.name}
		</span>
	)
}));

const ROWS = SIDEBAR_ROWS.options.map((option) => ({ value: option.id, label: option.name }));

const ROWS_DETAIL: Record<SidebarRowsId, string> = {
	detailed: 'Title over repository and state',
	compact: 'One line each'
};

/** Settings → Appearance: the theme, the typeface, the palette and the sidebar's rows. They live in this browser, so they work without the review server. */
export function AppearanceSection() {
	const { theme, pickTheme, palette, pickPalette, typeface, pickTypeface, sidebarRows, pickSidebarRows } =
		useAppearance();

	/** The control gives back a string; only one of the three themes is ever saved. */
	function chooseTheme(value: string): void {
		const next = THEMES.find((item) => item.value === value);

		if (next) pickTheme(next.value);
	}

	/** The control gives back a string; only a face's own id is ever saved. */
	function chooseTypeface(value: string): void {
		const next = TYPEFACE.options.find((option) => option.id === value);

		if (next) pickTypeface(next.id);
	}

	/** The control gives back a string; only a density's own id is ever saved. */
	function chooseRows(value: string): void {
		const next = SIDEBAR_ROWS.options.find((option) => option.id === value);

		if (next) pickSidebarRows(next.id);
	}

	return (
		<div className="settings">
			<SettingsGroup title="Theme">
				<SettingsRow name="Color mode" detail={DETAIL[theme]}>
					<SegmentedControl aria-label="Theme" value={theme} onValueChange={chooseTheme} options={THEMES} />
				</SettingsRow>
				<SettingsRow name="Typeface" detail="Code stays in Geist Mono">
					<SegmentedControl aria-label="Typeface" value={typeface} onValueChange={chooseTypeface} options={TYPEFACES} />
				</SettingsRow>
			</SettingsGroup>
			<SettingsGroup title="Palette">
				<PalettePicker value={palette} onPick={pickPalette} />
			</SettingsGroup>
			<SettingsGroup title="Layout">
				<SettingsRow name="Sidebar rows" detail={ROWS_DETAIL[sidebarRows]}>
					<SegmentedControl aria-label="Sidebar rows" value={sidebarRows} onValueChange={chooseRows} options={ROWS} />
				</SettingsRow>
			</SettingsGroup>
		</div>
	);
}
