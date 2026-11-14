'use client';

import type { ThemeChoice } from '@recoder/shared';
import { SegmentedControl } from '@recoder/ui';
import { Monitor, Moon, Sun } from 'lucide-react';
import type { ReactNode } from 'react';

import { TYPEFACE } from '@/lib/appearance/choices';
import { useAppearance } from '@/lib/settings/use-appearance';

import { PalettePicker } from './palette-picker';
import { SettingsGroup, SettingsRow } from './settings-group';

const THEMES: { value: ThemeChoice; label: string; icon: ReactNode }[] = [
	{ value: 'system', label: 'System', icon: <Monitor /> },
	{ value: 'light', label: 'Light', icon: <Sun /> },
	{ value: 'dark', label: 'Dark', icon: <Moon /> }
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

/** Settings → Appearance: the theme, the typeface and the palette. They live in this browser, so they work without the review server. */
export function AppearanceSection() {
	const { theme, pickTheme, palette, pickPalette, typeface, pickTypeface } = useAppearance();

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
		</div>
	);
}
