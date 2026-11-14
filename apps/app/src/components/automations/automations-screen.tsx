import { SettingsPage } from '@/components/settings/settings-page';

import { AutomationsGroups } from './automations-groups';

/** Automations: what starts a review without a click, which repositories it watches, and what it started. */
export function AutomationsScreen() {
	return (
		<SettingsPage name="Automations">
			<AutomationsGroups />
		</SettingsPage>
	);
}
