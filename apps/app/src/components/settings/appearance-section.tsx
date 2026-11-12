'use client';

import type { ThemeChoice } from '@recoder/shared';
import { SegmentedControl } from '@recoder/ui';

import { useTheme } from '@/lib/shell/theme';

import { THEME } from './row-copy';
import { SettingsGroup, SettingsRow } from './settings-group';

/** Settings → Appearance: the theme. It lives in this browser, so it works without the review server. */
export function AppearanceSection() {
	const choice = useTheme((state) => state.choice);

	return (
		<div className="settings-stack">
			<SettingsGroup title="Display" group="display">
				<SettingsRow name={THEME.name} description={THEME.description}>
					<SegmentedControl
						aria-label={THEME.name}
						value={choice}
						onValueChange={(value) => useTheme.getState().set(value as ThemeChoice)}
						options={THEME.options}
					/>
				</SettingsRow>
			</SettingsGroup>
		</div>
	);
}
