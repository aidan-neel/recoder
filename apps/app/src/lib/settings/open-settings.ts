import { inSettings, settingsHref } from '../shell/routes';
import { navigate, stepBackTo } from '../shell/navigation';
import type { SettingsSection } from './sections';

/** Opens a section of Settings in the tab on screen, the first section when none is named; Back returns to the page. */
export function openSettings(section?: SettingsSection): void {
	navigate(settingsHref(section));
}

/**
 * Leaves Settings for the page the tab showed before it, as Settings' back arrow does; a tab that opened on Settings
 * goes on to `home` instead.
 */
export function leaveSettings(home: string): void {
	if (!stepBackTo((href) => !inSettings(href.split('?')[0]))) navigate(home);
}
