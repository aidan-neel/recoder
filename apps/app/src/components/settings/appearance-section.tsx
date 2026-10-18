'use client';

import type { ThemeChoice } from '@recoder/shared';
import { SegmentedControl } from '@recoder/ui';
import { Monitor, Moon, Sun } from 'lucide-react';

import { useTheme } from '@/lib/shell/theme';

import { SettingsGroup, SettingsRow } from './settings-group';

const THEMES = [
	{ value: 'system', label: 'System', icon: <Monitor aria-hidden /> },
	{ value: 'light', label: 'Light', icon: <Sun aria-hidden /> },
	{ value: 'dark', label: 'Dark', icon: <Moon aria-hidden /> }
];

/** Settings → Appearance: the theme. It lives in this browser, so it works without the review server. */
export function AppearanceSection() {
	const choice = useTheme((state) => state.choice);

	return (
		<SettingsGroup title="Display">
			<SettingsRow name="Theme" description="System follows your device">
				<SegmentedControl
					aria-label="Theme"
					value={choice}
					onValueChange={(value) => useTheme.getState().set(value as ThemeChoice)}
					options={THEMES}
				/>
			</SettingsRow>
		</SettingsGroup>
	);
}
