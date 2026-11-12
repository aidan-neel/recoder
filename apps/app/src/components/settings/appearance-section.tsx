'use client';

import type { ThemeChoice } from '@recoder/shared';
import { SegmentedControl } from '@recoder/ui';
import { Monitor, Moon, Sun } from 'lucide-react';
import type { ReactNode } from 'react';

import { useAppearance } from '@/lib/settings/use-appearance';

import { SettingsGroup, SettingsRow } from './settings-group';

const CHOICES: { value: ThemeChoice; label: string; icon: ReactNode }[] = [
	{ value: 'system', label: 'System', icon: <Monitor /> },
	{ value: 'light', label: 'Light', icon: <Sun /> },
	{ value: 'dark', label: 'Dark', icon: <Moon /> }
];

const DETAIL: Record<ThemeChoice, string> = {
	system: 'Follows your device',
	light: 'Always light',
	dark: 'Always dark'
};

/** Settings → Appearance: the theme. It lives in this browser, so it works without the review server. */
export function AppearanceSection() {
	const { choice, set } = useAppearance();

	/** The control gives back a string; only one of the three choices is ever saved. */
	function pick(value: string): void {
		const next = CHOICES.find((item) => item.value === value);

		if (next) set(next.value);
	}

	return (
		<div className="settings">
			<SettingsGroup title="Theme">
				<SettingsRow name="Color mode" detail={DETAIL[choice]}>
					<SegmentedControl aria-label="Theme" value={choice} onValueChange={pick} options={CHOICES} />
				</SettingsRow>
			</SettingsGroup>
		</div>
	);
}
